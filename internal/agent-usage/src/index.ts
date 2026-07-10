/**
 * agent-usage — token-usage extraction from agent transcript files.
 *
 * **Strictly zero runtime dependencies.** This module parses the on-disk
 * transcript *file formats* (Claude Code JSONL, Codex rollout JSONL) using
 * nothing but `JSON.parse` and plain field access. It MUST NOT import any
 * agent SDK (`@anthropic-ai/claude-agent-sdk`, codex/ACP SDK, …) — parsing a
 * Claude transcript does not require the Claude SDK, and keeping this module
 * SDK-free is what lets it ship in *every* agent image (incl. the codex image
 * reading old `.claude` files after a core switch) without leaking deps.
 *
 * Node fs / HTTP wiring lives in `./node.ts` and `./routes.ts`; this file is
 * pure and unit-testable with in-memory string[] fixtures.
 *
 * Collection contract (see plan §10.3, all prod-verified):
 *  - claude: `message.usage` is a per-message DELTA → sum; dedup by `message.id`;
 *            the same message.id is written repeatedly while streaming
 *            (`out=[8,8,8,284]`) → keep the LAST (complete) occurrence.
 *  - codex:  `token_count.info.total_token_usage` is a CUMULATIVE total → emit
 *            the per-event DELTA (current − previous). NEVER sum
 *            `last_token_usage` (overlaps, ~1.9× double-count). OpenAI counts
 *            cached inside input → store uncached = input − cached.
 *  - missing / non-numeric fields → fall back to 0 and warn (never throw);
 *            the record is flagged `fieldsIncomplete`.
 */

export type UsageSource = 'claude' | 'codex' | 'goose'

/**
 * One normalized usage record = one billable unit of consumption (a Claude API
 * call / a Codex token_count increment). Workspace/user attribution is added at
 * ingestion time (the pod *is* the workspace), not here.
 */
export interface UsageRecord {
  source: UsageSource
  /** Logical session this belongs to (parent session for sub-agent records). */
  sessionId: string
  /** Model that produced this record (snapshotted per-record; may vary per turn). */
  model: string
  /** ISO-8601 timestamp of the record. */
  ts: string
  // ── billable token counts (per-record delta; 0 = real zero, see fieldsIncomplete) ──
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  /** Claude ephemeral-5m cache write (subset of cacheCreationTokens). */
  cacheCreation5mTokens: number
  /** Claude ephemeral-1h cache write (subset of cacheCreationTokens; ~1.6–2× price). */
  cacheCreation1hTokens: number
  reasoningTokens: number
  webSearchRequests: number
  /** Claude fast-mode marker (future pricing ×); null when unknown. */
  speed: 'standard' | 'fast' | null
  /** True when any field was missing/invalid and defaulted to 0 (audit). */
  fieldsIncomplete: boolean
  /** Idempotency key for the append-only ledger (UNIQUE, ON CONFLICT DO NOTHING). */
  dedupKey: string
}

export type WarnFn = (msg: string) => void

/** Per-file fingerprint to detect a transcript changed / was replaced / truncated. */
export interface FileFingerprint {
  dev: number
  ino: number
  size: number
  mtimeMs: number
}

/** Cursor = fingerprint per transcript path; control-plane owns and persists it. */
export type SweepCursors = Record<string, FileFingerprint>

/** Wire shape of the agent's `POST /usage` response. */
export interface UsageSweepResponse {
  records: UsageRecord[]
  cursors: SweepCursors
  /**
   * True when a per-call file cap (maxFiles) stopped the sweep before all
   * changed files were processed. The caller should pull again (with the
   * returned cursors) to drain the rest. Lets a large backlog (first pull of a
   * workspace with thousands of transcripts) be ingested in bounded batches
   * instead of one giant response + insert.
   */
  hasMore: boolean
}

export interface ParseOpts {
  /** Called on any missing/invalid field or unparseable line. Default: console.warn. */
  onWarn?: WarnFn
  /** Override the session id (e.g. attribute sub-agent files to the parent session). */
  sessionId?: string
}

export interface ClaudeParseOpts extends ParseOpts {
  /**
   * Include the trailing, possibly-still-streaming assistant message. Default
   * false: when the last entry in the input is an assistant message it may be
   * mid-stream (partial usage), so we defer it — never insert a partial that
   * `ON CONFLICT DO NOTHING` would then pin. Set true only when the turn is
   * known-settled (e.g. pulling after `session.ended`).
   */
  includeTrailing?: boolean
}

export interface CodexParseOpts extends ParseOpts {
  /** Model to use when the rollout carries none (codex often omits it). */
  defaultModel?: string
}

function defaultWarn(msg: string): void {
  console.warn(`[agent-usage] ${msg}`)
}

/** Coerce to a finite number; non-numbers → 0 and mark the flags incomplete. */
function num(
  v: unknown,
  ctx: string,
  field: string,
  flags: { incomplete: boolean },
  warn: WarnFn,
): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (v == null) return 0 // absent optional field — silent 0, not "incomplete"
  flags.incomplete = true
  warn(`${ctx}: non-numeric ${field}=${JSON.stringify(v)}, defaulting to 0`)
  return 0
}

/** Like num() but warns on absence too — for fields we expect to be present. */
function reqNum(
  v: unknown,
  ctx: string,
  field: string,
  flags: { incomplete: boolean },
  warn: WarnFn,
): number {
  if (v == null) {
    flags.incomplete = true
    warn(`${ctx}: missing ${field}, defaulting to 0`)
    return 0
  }
  return num(v, ctx, field, flags, warn)
}

// ──────────────────────────────────────────────────────────────────────────
// Claude Code transcript (~/.claude/projects/<slug>/<sdkSession>.jsonl)
// ──────────────────────────────────────────────────────────────────────────

interface ClaudeAssistant {
  type: string
  timestamp?: string
  sessionId?: string
  isSidechain?: boolean
  message?: {
    id?: string
    model?: string
    usage?: Record<string, unknown>
  }
}

/**
 * Reconcile Claude cache-creation: legacy flat `cache_creation_input_tokens`
 * vs nested `cache_creation.{ephemeral_5m,ephemeral_1h}_input_tokens`.
 * Returns max(flat, 5m+1h) as the total so neither representation loses data.
 */
function claudeCacheCreation(
  usage: Record<string, unknown>,
  ctx: string,
  flags: { incomplete: boolean },
  warn: WarnFn,
): { total: number; m5: number; h1: number } {
  const flat = num(
    usage.cache_creation_input_tokens,
    ctx,
    'cache_creation_input_tokens',
    flags,
    warn,
  )
  const nested = usage.cache_creation as Record<string, unknown> | undefined
  const m5 = num(nested?.ephemeral_5m_input_tokens, ctx, 'ephemeral_5m_input_tokens', flags, warn)
  const h1 = num(nested?.ephemeral_1h_input_tokens, ctx, 'ephemeral_1h_input_tokens', flags, warn)
  const splitTotal = m5 + h1
  const total = Math.max(flat, splitTotal)
  return { total, m5, h1 }
}

function buildClaudeRecord(
  entry: ClaudeAssistant,
  opts: ClaudeParseOpts,
  warn: WarnFn,
): UsageRecord {
  const m = entry.message!
  const id = m.id!
  const usage = (m.usage ?? {}) as Record<string, unknown>
  const ctx = `claude msg ${id}`
  const flags = { incomplete: false }
  const cc = claudeCacheCreation(usage, ctx, flags, warn)
  const rawSpeed = usage.speed
  const speed: UsageRecord['speed'] =
    rawSpeed === 'fast' ? 'fast' : rawSpeed === 'standard' ? 'standard' : null
  const serverTool = usage.server_tool_use as Record<string, unknown> | undefined
  return {
    source: 'claude',
    sessionId: opts.sessionId ?? entry.sessionId ?? '',
    model: m.model ?? 'unknown',
    ts: entry.timestamp ?? '',
    inputTokens: reqNum(usage.input_tokens, ctx, 'input_tokens', flags, warn),
    outputTokens: reqNum(usage.output_tokens, ctx, 'output_tokens', flags, warn),
    cacheReadTokens: num(
      usage.cache_read_input_tokens,
      ctx,
      'cache_read_input_tokens',
      flags,
      warn,
    ),
    cacheCreationTokens: cc.total,
    cacheCreation5mTokens: cc.m5,
    cacheCreation1hTokens: cc.h1,
    reasoningTokens: 0, // Claude does not report reasoning tokens
    webSearchRequests: num(
      serverTool?.web_search_requests,
      ctx,
      'web_search_requests',
      flags,
      warn,
    ),
    speed,
    fieldsIncomplete: flags.incomplete,
    dedupKey: `claude:${id}`,
  }
}

/**
 * Parse a Claude Code transcript (array of JSONL lines) into usage records.
 * Dedups streaming re-writes of the same `message.id` to the LAST occurrence,
 * and (by default) defers a trailing in-flight assistant message.
 */
export function parseClaudeTranscript(lines: string[], opts: ClaudeParseOpts = {}): UsageRecord[] {
  const warn = opts.onWarn ?? defaultWarn
  // message.id -> last occurrence (dedupe-to-last: streaming writes the same id
  // repeatedly with growing usage; the final write carries the complete count).
  const lastById = new Map<string, ClaudeAssistant>()
  // Track whether the final non-empty entry is an assistant (=> possibly in-flight).
  let trailingAssistantId: string | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line || !line.trim()) continue
    let entry: ClaudeAssistant
    try {
      entry = JSON.parse(line) as ClaudeAssistant
    } catch {
      warn(`claude: skipping unparseable line ${i}`)
      continue
    }
    if (entry.type !== 'assistant') {
      trailingAssistantId = null // a non-assistant entry settles any prior assistant
      continue
    }
    const m = entry.message
    if (!m || !m.id || !m.usage) {
      // assistant without usage (e.g. pure tool_use streamed shell) — ignore
      trailingAssistantId = null
      continue
    }
    lastById.set(m.id, entry)
    trailingAssistantId = m.id
  }

  const records: UsageRecord[] = []
  for (const [id, entry] of lastById) {
    if (!opts.includeTrailing && id === trailingAssistantId) continue // defer in-flight tail
    records.push(buildClaudeRecord(entry, opts, warn))
  }
  return records
}

// ──────────────────────────────────────────────────────────────────────────
// Codex rollout (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl)
// ──────────────────────────────────────────────────────────────────────────

export interface CodexTotals {
  uncachedInput: number
  cacheRead: number
  output: number
  reasoning: number
  total: number
}

const ZERO_TOTALS: CodexTotals = {
  uncachedInput: 0,
  cacheRead: 0,
  output: 0,
  reasoning: 0,
  total: 0,
}

interface CodexEntry {
  type?: string
  timestamp?: string
  payload?: Record<string, unknown>
}

/**
 * Parse a Codex rollout (array of JSONL lines) into usage records.
 *
 * Codex reports a running cumulative `total_token_usage`; we emit the per-event
 * DELTA against the previous total. Summing `last_token_usage` is wrong (it
 * overlaps within a turn → ~1.9× double-count), so we never use it.
 *
 * Re-reading the whole file is safe & deterministic: deltas recompute
 * identically and the dedupKey (= cumulative total) makes re-insert idempotent.
 */
export function parseCodexRollout(lines: string[], opts: CodexParseOpts = {}): UsageRecord[] {
  const warn = opts.onWarn ?? defaultWarn
  let sessionId = opts.sessionId ?? ''
  let forkedFromId = ''
  let model = opts.defaultModel ?? 'unknown'
  let prev: CodexTotals = ZERO_TOTALS
  const records: UsageRecord[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line || !line.trim()) continue
    let entry: CodexEntry
    try {
      entry = JSON.parse(line) as CodexEntry
    } catch {
      warn(`codex: skipping unparseable line ${i}`)
      continue
    }
    const payload = (entry.payload ?? {}) as Record<string, unknown>

    if (entry.type === 'session_meta') {
      sessionId = (payload.id as string) ?? (payload.session_id as string) ?? sessionId
      forkedFromId = (payload.forked_from_id as string) ?? forkedFromId
      if (typeof payload.model === 'string') model = payload.model
      continue
    }
    if (entry.type === 'turn_context') {
      if (typeof payload.model === 'string') model = payload.model
      continue
    }
    if (entry.type !== 'event_msg' || payload.type !== 'token_count') continue

    const info = payload.info as Record<string, unknown> | null | undefined
    if (!info) continue // early token_count carries info:null — no usage yet
    if (typeof info.model === 'string') model = info.model
    const t = info.total_token_usage as Record<string, unknown> | undefined
    if (!t) continue

    const ctx = `codex ${sessionId} @${entry.timestamp ?? '?'}`
    const flags = { incomplete: false }
    const inputRaw = num(t.input_tokens, ctx, 'input_tokens', flags, warn)
    const cached = num(t.cached_input_tokens, ctx, 'cached_input_tokens', flags, warn)
    const cur: CodexTotals = {
      uncachedInput: Math.max(0, inputRaw - cached), // OpenAI folds cached into input
      cacheRead: cached,
      output: num(t.output_tokens, ctx, 'output_tokens', flags, warn),
      reasoning: num(t.reasoning_output_tokens, ctx, 'reasoning_output_tokens', flags, warn),
      total: num(t.total_tokens, ctx, 'total_tokens', flags, warn),
    }

    // Reset/fork guard: cumulative should be monotonic. A drop means a fresh or
    // forked session replayed from zero → diff against zero, not the old high.
    const base = cur.total < prev.total ? ZERO_TOTALS : prev
    const rec: UsageRecord = {
      source: 'codex',
      sessionId,
      model,
      ts: entry.timestamp ?? '',
      inputTokens: Math.max(0, cur.uncachedInput - base.uncachedInput),
      outputTokens: Math.max(0, cur.output - base.output),
      cacheReadTokens: Math.max(0, cur.cacheRead - base.cacheRead),
      cacheCreationTokens: 0, // codex has no separate cache-write accounting
      cacheCreation5mTokens: 0,
      cacheCreation1hTokens: 0,
      reasoningTokens: Math.max(0, cur.reasoning - base.reasoning),
      webSearchRequests: 0,
      speed: null,
      fieldsIncomplete: flags.incomplete,
      dedupKey: `codex:${forkedFromId || sessionId}:${cur.total}`,
    }
    prev = cur
    // Skip no-op increments (repeated token_count with unchanged totals).
    if (
      rec.inputTokens === 0 &&
      rec.outputTokens === 0 &&
      rec.cacheReadTokens === 0 &&
      rec.reasoningTokens === 0
    ) {
      continue
    }
    records.push(rec)
  }
  return records
}

// ── goose (ACP adapter usage log) ──

export interface AcpUsageParseOpts {
  sessionId?: string
  defaultModel?: string
  onWarn?: WarnFn
}

/**
 * Parse the ACP adapter's own usage log (`$HOME/.acp-usage/<sessionId>.jsonl`).
 *
 * Goose persists sessions in SQLite (not parseable here under the zero-dep
 * rule), so the goose agent's acp-server appends one JSON line per completed
 * prompt turn from `PromptResponse.usage`:
 *
 *   {"ts":"...","model":"...","input_tokens":n,"output_tokens":n,"total_tokens":n}
 *
 * Values are PER-TURN sums (each LLM request bills its full input context, so
 * summing lines is the correct billing semantics — no cumulative/delta dance).
 * Cache/reasoning splits aren't available on this path (goose only reports
 * them via its gated custom MessageUsage notification), so records are
 * flagged `fieldsIncomplete`.
 *
 * dedupKey uses the line index — stable across re-sweeps of the same
 * append-only file, so ledger re-inserts are idempotent.
 */
export function parseAcpUsageLog(lines: string[], opts: AcpUsageParseOpts = {}): UsageRecord[] {
  const warn = opts.onWarn ?? defaultWarn
  const sessionId = opts.sessionId ?? ''
  const records: UsageRecord[] = []
  // Baseline for accumulated-counter lines (per file = per session).
  let prevAccInput = 0
  let prevAccOutput = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    let obj: Record<string, unknown>
    try {
      obj = JSON.parse(line)
    } catch {
      continue // torn tail write — picked up complete on the next sweep
    }
    const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
    if (typeof obj.ts !== 'string') {
      warn(`[agent-usage] acp-usage line ${i} missing ts (session=${sessionId})`)
    }

    // Two line shapes (see the goose agent's recordUsage):
    //  - accumulated: {accumulated_input_tokens, accumulated_output_tokens}
    //    session-cumulative → emit the per-line DELTA (codex pattern);
    //    dedupKey = cumulative total, so re-sweeps stay idempotent.
    //  - direct: {input_tokens, output_tokens} per-turn values (fallback when
    //    the agent saw no accumulated counters) → emit as-is, line-index key.
    const isAccumulated =
      obj.accumulated_input_tokens != null || obj.accumulated_output_tokens != null
    let input: number
    let output: number
    let dedupKey: string
    if (isAccumulated) {
      const accInput = num(obj.accumulated_input_tokens)
      const accOutput = num(obj.accumulated_output_tokens)
      input = Math.max(0, accInput - prevAccInput)
      output = Math.max(0, accOutput - prevAccOutput)
      prevAccInput = accInput
      prevAccOutput = accOutput
      dedupKey = `goose:${sessionId}:${accInput + accOutput}`
    } else {
      input = num(obj.input_tokens)
      output = num(obj.output_tokens)
      dedupKey = `goose:${sessionId}:${i}`
    }
    if (input === 0 && output === 0) continue

    records.push({
      source: 'goose',
      sessionId,
      model: (typeof obj.model === 'string' && obj.model) || opts.defaultModel || 'unknown',
      ts: typeof obj.ts === 'string' ? obj.ts : new Date(0).toISOString(),
      inputTokens: input,
      outputTokens: output,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      cacheCreation5mTokens: 0,
      cacheCreation1hTokens: 0,
      reasoningTokens: 0,
      webSearchRequests: 0,
      speed: null,
      // cache/reasoning splits genuinely unavailable on this path
      fieldsIncomplete: true,
      dedupKey,
    })
  }
  return records
}
