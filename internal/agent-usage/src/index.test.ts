import { describe, expect, test, vi } from 'vitest'
import { type UsageRecord, parseClaudeTranscript, parseCodexRollout } from './index.ts'

// ── helpers ──────────────────────────────────────────────────────────────

function claudeAssistant(opts: {
  id: string
  out?: number
  input?: number
  cacheRead?: number
  cacheCreationFlat?: number
  m5?: number
  h1?: number
  model?: string
  speed?: string
  webSearch?: number
  ts?: string
  sessionId?: string
}): string {
  const usage: Record<string, unknown> = {
    input_tokens: opts.input ?? 3,
    output_tokens: opts.out ?? 50,
    cache_read_input_tokens: opts.cacheRead ?? 0,
  }
  if (opts.cacheCreationFlat !== undefined)
    usage.cache_creation_input_tokens = opts.cacheCreationFlat
  if (opts.m5 !== undefined || opts.h1 !== undefined) {
    usage.cache_creation = {
      ephemeral_5m_input_tokens: opts.m5 ?? 0,
      ephemeral_1h_input_tokens: opts.h1 ?? 0,
    }
  }
  if (opts.speed) usage.speed = opts.speed
  if (opts.webSearch !== undefined) usage.server_tool_use = { web_search_requests: opts.webSearch }
  return JSON.stringify({
    type: 'assistant',
    timestamp: opts.ts ?? '2026-05-30T15:00:00.000Z',
    sessionId: opts.sessionId ?? 'sess-claude',
    isSidechain: false,
    message: { id: opts.id, model: opts.model ?? 'claude-sonnet-4-6', usage },
  })
}

function userLine(): string {
  return JSON.stringify({
    type: 'user',
    timestamp: '2026-05-30T15:00:01.000Z',
    message: { role: 'user' },
  })
}

function codexTokenCount(opts: {
  input?: number
  cached?: number
  output?: number
  reasoning?: number
  total?: number
  infoNull?: boolean
  model?: string
  ts?: string
}): string {
  const info = opts.infoNull
    ? null
    : {
        model: opts.model ?? null,
        total_token_usage: {
          input_tokens: opts.input ?? 0,
          cached_input_tokens: opts.cached ?? 0,
          output_tokens: opts.output ?? 0,
          reasoning_output_tokens: opts.reasoning ?? 0,
          total_tokens: opts.total ?? 0,
        },
        // last_token_usage intentionally inflated to prove we never sum it.
        last_token_usage: {
          input_tokens: 999999,
          cached_input_tokens: 999999,
          output_tokens: 999999,
          reasoning_output_tokens: 999999,
          total_tokens: 999999,
        },
      }
  return JSON.stringify({
    type: 'event_msg',
    timestamp: opts.ts ?? '2026-05-30T15:07:45.000Z',
    payload: { type: 'token_count', info, rate_limits: null },
  })
}

function codexSessionMeta(id: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'session_meta',
    timestamp: '2026-05-30T15:07:43.825Z',
    payload: { id, cwd: '/workspace', originator: 'codex_cli_rs', ...extra },
  })
}

// ── Claude ─────────────────────────────────────────────────────────────────

describe('parseClaudeTranscript', () => {
  test('maps real-shape usage fields (from prod sample)', () => {
    // exact usage object captured from a prod claude transcript
    const line = JSON.stringify({
      type: 'assistant',
      timestamp: '2026-05-30T15:00:00.000Z',
      sessionId: 'sess-x',
      message: {
        id: 'msg_01T7QsRMRbHaR7bCW9noL4xT',
        model: 'claude-sonnet-4-6',
        usage: {
          input_tokens: 3,
          cache_creation_input_tokens: 25342,
          cache_read_input_tokens: 0,
          output_tokens: 77,
          server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
          cache_creation: { ephemeral_1h_input_tokens: 25342, ephemeral_5m_input_tokens: 0 },
          speed: 'standard',
        },
      },
    })
    const [r] = parseClaudeTranscript([line, userLine()]) // userLine settles the assistant
    expect(r).toMatchObject<Partial<UsageRecord>>({
      source: 'claude',
      sessionId: 'sess-x',
      model: 'claude-sonnet-4-6',
      inputTokens: 3,
      outputTokens: 77,
      cacheReadTokens: 0,
      cacheCreationTokens: 25342,
      cacheCreation5mTokens: 0,
      cacheCreation1hTokens: 25342,
      reasoningTokens: 0,
      webSearchRequests: 0,
      speed: 'standard',
      fieldsIncomplete: false,
      dedupKey: 'claude:msg_01T7QsRMRbHaR7bCW9noL4xT',
    })
  })

  test('dedupes streaming re-writes of the same message.id to the LAST (complete) one', () => {
    // prod pattern: same id written 4× as it streams, out grows 8→8→8→284
    const lines = [
      claudeAssistant({ id: 'm1', out: 8 }),
      claudeAssistant({ id: 'm1', out: 8 }),
      claudeAssistant({ id: 'm1', out: 8 }),
      claudeAssistant({ id: 'm1', out: 284 }),
      userLine(), // settles m1
    ]
    const recs = parseClaudeTranscript(lines)
    expect(recs).toHaveLength(1)
    expect(recs[0].outputTokens).toBe(284)
  })

  test('defers a trailing in-flight assistant message by default', () => {
    const lines = [claudeAssistant({ id: 'm1', out: 100 }), claudeAssistant({ id: 'm2', out: 8 })]
    // m2 is the trailing entry → possibly mid-stream → deferred
    const recs = parseClaudeTranscript(lines)
    expect(recs.map((r) => r.dedupKey)).toEqual(['claude:m1'])
  })

  test('includeTrailing emits the trailing message (turn known-settled)', () => {
    const lines = [claudeAssistant({ id: 'm1', out: 100 }), claudeAssistant({ id: 'm2', out: 284 })]
    const recs = parseClaudeTranscript(lines, { includeTrailing: true })
    expect(recs.map((r) => r.dedupKey).sort()).toEqual(['claude:m1', 'claude:m2'])
  })

  test('a non-assistant final entry settles the last assistant (no defer needed)', () => {
    const lines = [claudeAssistant({ id: 'm1', out: 284 }), userLine()]
    const recs = parseClaudeTranscript(lines)
    expect(recs).toHaveLength(1)
    expect(recs[0].outputTokens).toBe(284)
  })

  test('cache_creation reconciliation = max(flat, 5m+1h)', () => {
    // nested present, flat absent
    let [r] = parseClaudeTranscript([claudeAssistant({ id: 'a', m5: 100, h1: 200 }), userLine()])
    expect(r.cacheCreationTokens).toBe(300)
    expect(r.cacheCreation5mTokens).toBe(100)
    expect(r.cacheCreation1hTokens).toBe(200)
    // flat present, nested absent
    ;[r] = parseClaudeTranscript([claudeAssistant({ id: 'b', cacheCreationFlat: 500 }), userLine()])
    expect(r.cacheCreationTokens).toBe(500)
    // both present, flat larger → max
    ;[r] = parseClaudeTranscript([
      claudeAssistant({ id: 'c', cacheCreationFlat: 999, m5: 100, h1: 200 }),
      userLine(),
    ])
    expect(r.cacheCreationTokens).toBe(999)
  })

  test('sessionId override attributes sub-agent records to the parent session', () => {
    const lines = [
      claudeAssistant({ id: 'sub1', sessionId: 'subagent-sess', out: 400 }),
      userLine(),
    ]
    const [r] = parseClaudeTranscript(lines, { sessionId: 'parent-sess' })
    expect(r.sessionId).toBe('parent-sess')
  })

  test('missing field falls back to 0, warns, and flags fieldsIncomplete', () => {
    const warn = vi.fn()
    const line = JSON.stringify({
      type: 'assistant',
      timestamp: 't',
      sessionId: 's',
      message: { id: 'm', model: 'claude-sonnet-4-6', usage: { input_tokens: 10 } }, // no output_tokens
    })
    const [r] = parseClaudeTranscript([line, userLine()], { onWarn: warn })
    expect(r.outputTokens).toBe(0)
    expect(r.fieldsIncomplete).toBe(true)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('missing output_tokens'))
  })

  test('skips unparseable lines without throwing, keeps the rest', () => {
    const warn = vi.fn()
    const recs = parseClaudeTranscript(
      ['{not json', claudeAssistant({ id: 'ok', out: 5 }), userLine()],
      {
        onWarn: warn,
      },
    )
    expect(recs).toHaveLength(1)
    expect(recs[0].dedupKey).toBe('claude:ok')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unparseable'))
  })

  test('reads fast speed', () => {
    const [r] = parseClaudeTranscript([claudeAssistant({ id: 'm', speed: 'fast' }), userLine()])
    expect(r.speed).toBe('fast')
  })
})

// ── Codex ────────────────────────────────────────────────────────────────

describe('parseCodexRollout', () => {
  test('single token_count: delta-from-zero = totals; uncached = input − cached', () => {
    const lines = [
      codexSessionMeta('sess-1'),
      codexTokenCount({ input: 500, cached: 100, output: 200, reasoning: 50, total: 750 }),
    ]
    const recs = parseCodexRollout(lines)
    expect(recs).toHaveLength(1)
    expect(recs[0]).toMatchObject<Partial<UsageRecord>>({
      source: 'codex',
      sessionId: 'sess-1',
      inputTokens: 400, // 500 - 100 cached
      cacheReadTokens: 100,
      outputTokens: 200,
      reasoningTokens: 50,
      cacheCreationTokens: 0,
      dedupKey: 'codex:sess-1:750',
    })
  })

  test('cumulative totals → per-event deltas; sum of deltas == final total (never sum last_token_usage)', () => {
    const lines = [
      codexSessionMeta('s'),
      codexTokenCount({ input: 100, output: 0, total: 100 }),
      codexTokenCount({ input: 250, output: 0, total: 250 }),
      codexTokenCount({ input: 400, output: 0, total: 400 }),
    ]
    const recs = parseCodexRollout(lines)
    expect(recs.map((r) => r.inputTokens)).toEqual([100, 150, 150]) // diffs, not 100/250/400
    const summed = recs.reduce((a, r) => a + r.inputTokens, 0)
    expect(summed).toBe(400) // == final cumulative; last_token_usage(999999×3) ignored
    expect(recs.map((r) => r.dedupKey)).toEqual(['codex:s:100', 'codex:s:250', 'codex:s:400'])
  })

  test('skips token_count with info:null (early event before any usage)', () => {
    const lines = [
      codexSessionMeta('s'),
      codexTokenCount({ infoNull: true }),
      codexTokenCount({ input: 10, total: 10 }),
    ]
    const recs = parseCodexRollout(lines)
    expect(recs).toHaveLength(1)
    expect(recs[0].inputTokens).toBe(10)
  })

  test('skips no-op token_count with unchanged total', () => {
    const lines = [
      codexSessionMeta('s'),
      codexTokenCount({ input: 100, total: 100 }),
      codexTokenCount({ input: 100, total: 100 }), // unchanged → delta 0 → skipped
    ]
    expect(parseCodexRollout(lines)).toHaveLength(1)
  })

  test('reset/fork guard: a cumulative drop diffs against zero, not the old high', () => {
    const lines = [
      codexSessionMeta('s'),
      codexTokenCount({ input: 1000, total: 1000 }),
      codexTokenCount({ input: 30, total: 30 }), // dropped → treated as fresh
    ]
    const recs = parseCodexRollout(lines)
    expect(recs.map((r) => r.inputTokens)).toEqual([1000, 30]) // not 1000 then -970
  })

  test('model resolution: session_meta < turn_context < info.model, with defaultModel fallback', () => {
    // no model anywhere → defaultModel
    let recs = parseCodexRollout([codexSessionMeta('s'), codexTokenCount({ input: 5, total: 5 })], {
      defaultModel: 'gpt-5.5',
    })
    expect(recs[0].model).toBe('gpt-5.5')
    // session_meta carries a model
    recs = parseCodexRollout([
      codexSessionMeta('s', { model: 'gpt-5-meta' }),
      codexTokenCount({ input: 5, total: 5 }),
    ])
    expect(recs[0].model).toBe('gpt-5-meta')
    // turn_context overrides session_meta
    recs = parseCodexRollout([
      codexSessionMeta('s', { model: 'gpt-5-meta' }),
      JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-5-turn' } }),
      codexTokenCount({ input: 5, total: 5 }),
    ])
    expect(recs[0].model).toBe('gpt-5-turn')
    // info.model wins for that event
    recs = parseCodexRollout([
      codexSessionMeta('s'),
      codexTokenCount({ input: 5, total: 5, model: 'gpt-5-info' }),
    ])
    expect(recs[0].model).toBe('gpt-5-info')
  })

  test('forked_from_id namespaces the dedup key', () => {
    const lines = [
      codexSessionMeta('child', { forked_from_id: 'parent' }),
      codexTokenCount({ input: 5, total: 5 }),
    ]
    expect(parseCodexRollout(lines)[0].dedupKey).toBe('codex:parent:5')
  })

  test('sessionId comes from session_meta.payload.id', () => {
    const recs = parseCodexRollout([
      codexSessionMeta('019e796d-real-id'),
      codexTokenCount({ input: 5, total: 5 }),
    ])
    expect(recs[0].sessionId).toBe('019e796d-real-id')
  })
})
