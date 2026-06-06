/**
 * Node fs-backed reader for agent-usage. Sweeps the on-disk transcript trees
 * inside an agent pod and returns normalized usage records.
 *
 * Import this in agent/cp code; never in unit tests (tests use the pure parsers
 * in ./index.ts with string[] fixtures).
 *
 * Strategy: a *changed* transcript file is re-parsed in full (cheap — per-session
 * files are bounded), and correctness is guaranteed downstream by the ledger's
 * UNIQUE(dedupKey) + ON CONFLICT DO NOTHING, so full re-reads are idempotent.
 * The per-file fingerprint only lets us skip unchanged files. A torn last line
 * (file being appended) fails JSON.parse and is skipped; the claude parser also
 * defers a trailing in-flight assistant message until the file goes quiescent.
 */

import { type Dirent, existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import {
  type FileFingerprint,
  type SweepCursors,
  type UsageRecord,
  type UsageSweepResponse,
  type WarnFn,
  parseClaudeTranscript,
  parseCodexRollout,
} from './index.js'

export type { FileFingerprint, SweepCursors }

export interface SweepOpts {
  /** Agent HOME (transcripts live under $HOME/.claude and $HOME/.codex). */
  homeDir: string
  /** Prior fingerprints; unchanged files are skipped. */
  cursors?: SweepCursors
  /**
   * Workspace's configured model, used as the fallback for any transcript
   * record that omits its own model. In practice only codex rollouts lack a
   * model; claude messages always carry `message.model`.
   */
  fallbackModel?: string
  /**
   * A file untouched for longer than this is "quiescent" → its trailing claude
   * message is treated as settled and emitted. Default 10s.
   */
  settleGraceMs?: number
  /** Wall-clock now (ms). Injectable for tests; defaults to Date.now(). */
  now?: number
  /**
   * Max number of *changed* files to process in this call. When the cap is hit,
   * the sweep stops and the result's `hasMore` is true; only processed files get
   * their fingerprint advanced, so the next call resumes on the rest. Unset =
   * no cap (process everything). Bounds memory / response size / insert size for
   * large backlogs.
   */
  maxFiles?: number
  onWarn?: WarnFn
}

function fingerprint(path: string): FileFingerprint | null {
  try {
    const s = statSync(path)
    return { dev: s.dev, ino: s.ino, size: s.size, mtimeMs: s.mtimeMs }
  } catch {
    return null
  }
}

function unchanged(a: FileFingerprint | undefined, b: FileFingerprint): boolean {
  return !!a && a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs
}

function readLines(path: string): string[] {
  return readFileSync(path, 'utf8').split('\n')
}

function listJsonl(dir: string): string[] {
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => join(dir, f))
  } catch {
    return []
  }
}

/** Recursively collect codex rollout files under .codex/sessions. */
function listCodexRollouts(sessionsDir: string): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.startsWith('rollout-') && e.name.endsWith('.jsonl')) out.push(p)
    }
  }
  if (existsSync(sessionsDir)) walk(sessionsDir)
  return out
}

/**
 * Sweep both transcript trees and return new/updated usage records plus
 * fingerprints. Always scans BOTH `.claude` and `.codex` regardless of the
 * current agent core — a workspace's PVC accumulates both across core switches.
 */
export function sweepUsage(opts: SweepOpts): UsageSweepResponse {
  const warn = opts.onWarn
  const now = opts.now ?? Date.now()
  const settleGraceMs = opts.settleGraceMs ?? 10_000
  const prev = opts.cursors ?? {}
  const cursors: SweepCursors = {}
  const records: UsageRecord[] = []
  let processed = 0
  let hasMore = false

  // Decide whether to read a file, and maintain the returned cursor:
  //   - vanished         → null, no cursor entry (dropped)
  //   - unchanged        → null, cursor retained (stays skipped next time)
  //   - changed & capped → null, cursor left ABSENT → next pull re-sees it as
  //                         changed and reads it (resumable backlog drain)
  //   - changed          → returns the fingerprint; cursor advanced, counted
  // Only changed files consume the maxFiles budget; unchanged files are always
  // retained regardless of the cap.
  const claimChanged = (file: string): FileFingerprint | null => {
    const fp = fingerprint(file)
    if (!fp) return null
    if (unchanged(prev[file], fp)) {
      cursors[file] = fp
      return null
    }
    if (opts.maxFiles !== undefined && processed >= opts.maxFiles) {
      hasMore = true
      return null
    }
    cursors[file] = fp
    processed++
    return fp
  }

  // A changed claude file → parse it, attributing its records to `sessionId`
  // (the parent session for sub-agent files). Trailing in-flight message is
  // emitted only once the file goes quiescent.
  const addClaudeFile = (file: string, sessionId: string) => {
    const fp = claimChanged(file)
    if (!fp) return
    const includeTrailing = now - fp.mtimeMs > settleGraceMs
    records.push(
      ...parseClaudeTranscript(readLines(file), { sessionId, includeTrailing, onWarn: warn }),
    )
    if (!includeTrailing) {
      // The parser may have deferred an in-flight trailing assistant entry
      // while the file is fresh. (Rare for claude — the SDK appends
      // last-prompt/ai-title after the usage row, so it's usually not trailing
      // — but a guard against truncated writes / future formats.) Do NOT
      // advance the cursor: a file that never changes again would be seen as
      // `unchanged` next sweep and the deferred record stranded forever.
      // Leaving the cursor absent makes the next sweep re-read until quiescent;
      // already-emitted records are idempotent via the ledger's dedup_key.
      delete cursors[file]
    }
  }

  // ── claude: .claude/projects/<slug>/<session>.jsonl  (+ <session>/subagents/) ──
  const projectsDir = join(opts.homeDir, '.claude', 'projects')
  if (existsSync(projectsDir)) {
    for (const slug of safeReaddir(projectsDir)) {
      const slugDir = join(projectsDir, slug)
      for (const file of listJsonl(slugDir)) {
        const sessionId = basename(file, '.jsonl')
        addClaudeFile(file, sessionId)
        // sub-agent transcripts → attribute to the parent session
        for (const sub of listSubagents(join(slugDir, sessionId, 'subagents'))) {
          addClaudeFile(sub, sessionId)
        }
      }
    }
  }

  // ── codex: .codex/sessions/YYYY/MM/DD/rollout-*.jsonl ──
  for (const file of listCodexRollouts(join(opts.homeDir, '.codex', 'sessions'))) {
    if (claimChanged(file) === null) continue
    // session id falls out of session_meta; filename is a fallback
    const fallbackId = basename(file, '.jsonl').replace(/^rollout-[0-9T-]+-/, '')
    records.push(
      ...parseCodexRollout(readLines(file), {
        sessionId: fallbackId,
        defaultModel: opts.fallbackModel,
        onWarn: warn,
      }),
    )
  }

  return { records, cursors, hasMore }
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

function listSubagents(dir: string): string[] {
  return listJsonl(dir).filter((f) => basename(f).startsWith('agent-'))
}
