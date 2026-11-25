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
 * The cursor only lets us skip files already ingested: those below its mtime
 * watermark, and those whose fingerprint is unchanged. A torn last line (file
 * being appended) fails JSON.parse and is skipped; the claude parser also
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
  type FileCursors,
  type FileFingerprint,
  type StoredSweepCursors,
  type SweepCursors,
  type UsageRecord,
  type UsageSweepResponse,
  type WarnFn,
  DEFAULT_SETTLE_GRACE_MS,
  normalizeCursors,
  parseAcpUsageLog,
  parseClaudeTranscript,
  parseCodexRollout,
} from './index.js'

export type { FileFingerprint, StoredSweepCursors, SweepCursors }

export interface SweepOpts {
  /** Agent HOME (transcripts live under $HOME/.claude and $HOME/.codex). */
  homeDir: string
  /** Cursor from the previous sweep; files it marks as ingested are skipped. */
  cursors?: StoredSweepCursors
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
  /**
   * Wall-clock now (ms) for the quiescence check. Injectable for tests;
   * defaults to Date.now(). The cursor watermark always uses the real clock.
   */
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

/**
 * How far behind the sweep's start the watermark is placed (on top of the
 * settle grace). Transcript mtimes are stamped by the volume's server, whose
 * clock may disagree with the agent's; the lag keeps a file written just before
 * or during the sweep above the watermark despite that skew.
 */
const WATERMARK_LAG_MS = 5 * 60_000

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

function unchanged(a: FileFingerprint | undefined, b: FileFingerprint): boolean {
  return !!a && a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs
}

async function readLines(path: string): Promise<string[]> {
  return (await readFile(path, 'utf8')).split('\n')
}

/** A claude transcript file and the session its records are attributed to. */
interface ClaudeFile {
  file: string
  sessionId: string
}

/**
 * Directory listing and stat for one sweep. Tracks whether every lookup either
 * succeeded or found nothing there: only then has the sweep seen the whole
 * tree, which the watermark needs before it may advance past anything.
 */
class TreeReader {
  complete = true

  private failed(e: unknown): void {
    const code = (e as NodeJS.ErrnoException)?.code
    if (code !== 'ENOENT' && code !== 'ENOTDIR') this.complete = false
  }

  async readdir(dir: string): Promise<string[]> {
    try {
      return await readdir(dir)
    } catch (e) {
      this.failed(e)
      return []
    }
  }

  async readdirEntries(dir: string): Promise<Dirent[]> {
    try {
      return await readdir(dir, { withFileTypes: true })
    } catch (e) {
      this.failed(e)
      return []
    }
  }

  async fingerprint(path: string): Promise<FileFingerprint | null> {
    try {
      const s = await stat(path)
      return { dev: s.dev, ino: s.ino, size: s.size, mtimeMs: s.mtimeMs }
    } catch (e) {
      this.failed(e)
      return null
    }
  }

  async listJsonl(dir: string): Promise<string[]> {
    return (await this.readdir(dir)).filter((f) => f.endsWith('.jsonl')).map((f) => join(dir, f))
  }

  /**
   * Claude transcripts under .claude/projects/<slug>/<session>.jsonl, each
   * followed by its sub-agent transcripts (<session>/subagents/agent-*.jsonl),
   * which are attributed to the parent session.
   */
  async listClaudeFiles(projectsDir: string): Promise<ClaudeFile[]> {
    const slugs = await this.readdir(projectsDir)
    const perSlug = await mapLimit(slugs, IO_CONCURRENCY, async (slug) => {
      const slugDir = join(projectsDir, slug)
      const sessions = await this.listJsonl(slugDir)
      const perSession = await mapLimit(sessions, IO_CONCURRENCY, async (file) => {
        const sessionId = basename(file, '.jsonl')
        const subs = (await this.listJsonl(join(slugDir, sessionId, 'subagents'))).filter((f) =>
          basename(f).startsWith('agent-'),
        )
        return [{ file, sessionId }, ...subs.map((sub) => ({ file: sub, sessionId }))]
      })
      return perSession.flat()
    })
    return perSlug.flat()
  }

  /** Codex rollouts, recursively under .codex/sessions. */
  async listCodexRollouts(sessionsDir: string): Promise<string[]> {
    const walk = async (dir: string): Promise<string[]> => {
      const entries = await this.readdirEntries(dir)
      const nested = await mapLimit(entries, IO_CONCURRENCY, async (e) => {
        const p = join(dir, e.name)
        if (e.isDirectory()) return walk(p)
        return e.name.startsWith('rollout-') && e.name.endsWith('.jsonl') ? [p] : []
      })
      return nested.flat()
    }
    return walk(sessionsDir)
  }
}

/**
 * Sweep both transcript trees and return new/updated usage records plus the
 * next cursor. Always scans BOTH `.claude` and `.codex` regardless of the
 * current agent core — a workspace's PVC accumulates both across core switches.
 */
export async function sweepUsage(opts: SweepOpts): Promise<UsageSweepResponse> {
  const startedAt = Date.now()
  const warn = opts.onWarn
  const now = opts.now ?? startedAt
  const settleGraceMs = opts.settleGraceMs ?? DEFAULT_SETTLE_GRACE_MS
  const { settledBefore: prevWatermark, files: prev } = normalizeCursors(opts.cursors)
  const files: FileCursors = {}
  const records: UsageRecord[] = []
  let processed = 0
  let hasMore = false

  const tree = new TreeReader()
  const claudeFiles = await tree.listClaudeFiles(join(opts.homeDir, '.claude', 'projects'))
  const codexFiles = await tree.listCodexRollouts(join(opts.homeDir, '.codex', 'sessions'))
  // goose (ACP adapter usage log): .acp-usage/<sessionId>.jsonl
  const acpFiles = await tree.listJsonl(join(opts.homeDir, '.acp-usage'))

  // Stat every file up front, concurrently. The claim pass below then walks the
  // files in a fixed order, so the maxFiles budget is spent deterministically.
  const allFiles = [...claudeFiles.map((c) => c.file), ...codexFiles, ...acpFiles]
  const stats = await mapLimit(allFiles, IO_CONCURRENCY, (f) => tree.fingerprint(f))
  const fingerprints = new Map(allFiles.map((file, i) => [file, stats[i]]))

  // Decide whether to read a file, and maintain the returned cursor:
  //   - vanished           → null, no cursor entry (dropped)
  //   - below watermark    → null, already ingested; needs no entry
  //   - unchanged          → null, entry retained (stays skipped next time)
  //   - changed & capped   → null, entry left ABSENT → next pull re-sees it as
  //                           changed and reads it (resumable backlog drain)
  //   - changed            → returns the fingerprint; entry advanced, counted
  // Only changed files consume the maxFiles budget; unchanged files are always
  // retained regardless of the cap.
  const claimChanged = (file: string): FileFingerprint | null => {
    const fp = fingerprints.get(file)
    if (!fp) return null
    if (fp.mtimeMs < prevWatermark) return null
    if (unchanged(prev[file], fp)) {
      files[file] = fp
      return null
    }
    if (opts.maxFiles !== undefined && processed >= opts.maxFiles) {
      hasMore = true
      return null
    }
    files[file] = fp
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
      // Leaving the entry absent makes the next sweep re-read until quiescent;
      // already-emitted records are idempotent via the ledger's dedup_key. The
      // file's mtime is within the settle grace, so it is above any watermark
      // this sweep sets.
      delete files[file]
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

  // The watermark may only advance once every file older than the new mark is
  // known to be ingested: the whole tree was listed and stat'ed without error,
  // and no changed file was left behind by the cap.
  const settledBefore =
    tree.complete && !hasMore
      ? Math.max(prevWatermark, startedAt - WATERMARK_LAG_MS - settleGraceMs)
      : prevWatermark
  for (const [file, fp] of Object.entries(files)) {
    if (fp.mtimeMs < settledBefore) delete files[file]
  }

  return { records, cursors: { settledBefore, files }, hasMore }
}
