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
 *
 * All filesystem access is async with bounded concurrency. The transcript trees
 * live on the workspace volume (often network-backed) and a long-lived workspace
 * accumulates tens of thousands of rollouts, each of which is stat'ed on every
 * sweep; doing that synchronously would block the agent's event loop for the
 * whole sweep, starving its health endpoint and in-flight turns.
 */

import type { Dirent } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import {
  type FileFingerprint,
  type SweepCursors,
  type UsageRecord,
  type UsageSweepResponse,
  type WarnFn,
  DEFAULT_SETTLE_GRACE_MS,
  parseAcpUsageLog,
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

/** Max concurrent filesystem calls (stat / readdir) issued by one sweep. */
const IO_CONCURRENCY = 16

/** Map `items` through `fn` with at most `limit` calls in flight; keeps input order. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

async function fingerprint(path: string): Promise<FileFingerprint | null> {
  try {
    const s = await stat(path)
    return { dev: s.dev, ino: s.ino, size: s.size, mtimeMs: s.mtimeMs }
  } catch {
    return null
  }
}

function unchanged(a: FileFingerprint | undefined, b: FileFingerprint): boolean {
  return !!a && a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs
}

async function readLines(path: string): Promise<string[]> {
  return (await readFile(path, 'utf8')).split('\n')
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir)
  } catch {
    return []
  }
}

async function listJsonl(dir: string): Promise<string[]> {
  return (await safeReaddir(dir)).filter((f) => f.endsWith('.jsonl')).map((f) => join(dir, f))
}

async function listSubagents(dir: string): Promise<string[]> {
  return (await listJsonl(dir)).filter((f) => basename(f).startsWith('agent-'))
}

/** A claude transcript file and the session its records are attributed to. */
interface ClaudeFile {
  file: string
  sessionId: string
}

/**
 * Collect claude transcripts under .claude/projects/<slug>/<session>.jsonl, each
 * followed by its sub-agent transcripts (<session>/subagents/agent-*.jsonl),
 * which are attributed to the parent session.
 */
async function listClaudeFiles(projectsDir: string): Promise<ClaudeFile[]> {
  const perSlug = await mapLimit(await safeReaddir(projectsDir), IO_CONCURRENCY, async (slug) => {
    const slugDir = join(projectsDir, slug)
    const sessions = await listJsonl(slugDir)
    const perSession = await mapLimit(sessions, IO_CONCURRENCY, async (file) => {
      const sessionId = basename(file, '.jsonl')
      const subs = await listSubagents(join(slugDir, sessionId, 'subagents'))
      return [{ file, sessionId }, ...subs.map((sub) => ({ file: sub, sessionId }))]
    })
    return perSession.flat()
  })
  return perSlug.flat()
}

/** Recursively collect codex rollout files under .codex/sessions. */
async function listCodexRollouts(sessionsDir: string): Promise<string[]> {
  const walk = async (dir: string): Promise<string[]> => {
    let entries: Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return []
    }
    const nested = await mapLimit(entries, IO_CONCURRENCY, async (e) => {
      const p = join(dir, e.name)
      if (e.isDirectory()) return walk(p)
      return e.name.startsWith('rollout-') && e.name.endsWith('.jsonl') ? [p] : []
    })
    return nested.flat()
  }
  return walk(sessionsDir)
}

/**
 * Sweep both transcript trees and return new/updated usage records plus
 * fingerprints. Always scans BOTH `.claude` and `.codex` regardless of the
 * current agent core — a workspace's PVC accumulates both across core switches.
 */
export async function sweepUsage(opts: SweepOpts): Promise<UsageSweepResponse> {
  const warn = opts.onWarn
  const now = opts.now ?? Date.now()
  const settleGraceMs = opts.settleGraceMs ?? DEFAULT_SETTLE_GRACE_MS
  const prev = opts.cursors ?? {}
  const cursors: SweepCursors = {}
  const records: UsageRecord[] = []
  let processed = 0
  let hasMore = false

  const claudeFiles = await listClaudeFiles(join(opts.homeDir, '.claude', 'projects'))
  const codexFiles = await listCodexRollouts(join(opts.homeDir, '.codex', 'sessions'))
  // goose (ACP adapter usage log): .acp-usage/<sessionId>.jsonl
  const acpFiles = await listJsonl(join(opts.homeDir, '.acp-usage'))

  // Stat every file up front, concurrently. The claim pass below then walks the
  // files in a fixed order, so the maxFiles budget is spent deterministically.
  const allFiles = [...claudeFiles.map((c) => c.file), ...codexFiles, ...acpFiles]
  const fingerprints = new Map<string, FileFingerprint | null>()
  const stats = await mapLimit(allFiles, IO_CONCURRENCY, fingerprint)
  allFiles.forEach((file, i) => fingerprints.set(file, stats[i]))

  // Decide whether to read a file, and maintain the returned cursor:
  //   - vanished         → null, no cursor entry (dropped)
  //   - unchanged        → null, cursor retained (stays skipped next time)
  //   - changed & capped → null, cursor left ABSENT → next pull re-sees it as
  //                         changed and reads it (resumable backlog drain)
  //   - changed          → returns the fingerprint; cursor advanced, counted
  // Only changed files consume the maxFiles budget; unchanged files are always
  // retained regardless of the cap.
  const claimChanged = (file: string): FileFingerprint | null => {
    const fp = fingerprints.get(file)
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
  const addClaudeFile = async (file: string, sessionId: string) => {
    const fp = claimChanged(file)
    if (!fp) return
    const includeTrailing = now - fp.mtimeMs > settleGraceMs
    records.push(
      ...parseClaudeTranscript(await readLines(file), {
        sessionId,
        includeTrailing,
        onWarn: warn,
      }),
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
  for (const { file, sessionId } of claudeFiles) {
    await addClaudeFile(file, sessionId)
  }

  // ── codex: .codex/sessions/YYYY/MM/DD/rollout-*.jsonl ──
  for (const file of codexFiles) {
    if (claimChanged(file) === null) continue
    // session id falls out of session_meta; filename is a fallback
    const fallbackId = basename(file, '.jsonl').replace(/^rollout-[0-9T-]+-/, '')
    records.push(
      ...parseCodexRollout(await readLines(file), {
        sessionId: fallbackId,
        defaultModel: opts.fallbackModel,
        onWarn: warn,
      }),
    )
  }

  // ── goose (ACP adapter usage log): .acp-usage/<sessionId>.jsonl ──
  // Written by the goose agent's recordUsage hook (goose's own SQLite session
  // store isn't parseable under the zero-dep rule). One line per prompt turn.
  for (const file of acpFiles) {
    if (claimChanged(file) === null) continue
    records.push(
      ...parseAcpUsageLog(await readLines(file), {
        sessionId: basename(file, '.jsonl'),
        defaultModel: opts.fallbackModel,
        onWarn: warn,
      }),
    )
  }

  return { records, cursors, hasMore }
}
