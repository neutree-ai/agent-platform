/**
 * UniversalEvent turn consumer.
 *
 * Sits on top of `readSSE` (raw SSE line reader). Parses each SSE `data:`
 * payload as a `UniversalEvent`, tracks turn lifecycle (session.started,
 * session.ended), and drives a set of plugins through `onStart` / `onEvent`
 * / `onError` / `onEnd` hooks.
 *
 * Contract summary (see README / design discussion for full rationale):
 *   - `runTurn` never throws. Upstream/stream errors become `TurnResult`
 *     with `reason !== 'completed'`.
 *   - `onEvent` is synchronous. Plugins must queue their own async work.
 *   - `onStart` / `onEnd` / `onError` are async. `onEnd` always runs, even
 *     after an error, so plugins can flush state.
 *   - Plugin exceptions in `onEvent` are logged and isolated — one bad
 *     plugin does not kill the turn or the other plugins.
 *   - Plugin exceptions in `onEnd` downgrade a `'completed'` result to
 *     `'error'` with the throw as cause.
 *   - JSON parse failures synthesize an `{ type: 'error' }` event fed to
 *     plugins; they do not abort the turn.
 *
 * When the primary stream ends before `session.ended` (either by closing
 * cleanly or by throwing), and a `reconnect` source is provided, `runTurn`
 * attempts **one** reconnect to pick up the remaining events. Plugins see
 * the reconnect events as a continuation of the same event stream — they
 * don't need to know a failover happened. External aborts and idle
 * timeouts do not trigger reconnect.
 */

import { readSSE } from './read-sse'
import type { UniversalEvent, TurnStats } from '../../types/events'

const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes

// ── Input ──

export interface TurnSource {
  /** Primary path. Caller performs the fetch and passes the Response back. */
  stream: () => Promise<Response>

  /**
   * Optional reconnect path. Invoked **at most once** when the primary
   * stream ends before `session.ended` (clean close, upstream error, or
   * `stream()` itself rejecting). Typical implementation: re-fetch
   * `/sessions/:id/reconnect` on the same agent to pick up buffered
   * events.
   *
   * Return `null` to indicate "nothing to reconnect to" — `runTurn` will
   * skip the attempt and fall through to the error path.
   *
   * Not triggered on external abort or idle timeout.
   */
  reconnect?: () => Promise<Response | null>

  /**
   * Idle timeout reset on every event. Defaults to 30 minutes. Pass 0 or
   * `Infinity` to disable.
   */
  idleTimeoutMs?: number

  /** External abort. Forwarded to the underlying `readSSE`. */
  signal?: AbortSignal
}

// ── Plugin ──

export interface TurnContext {
  signal: AbortSignal | undefined
}

export type TurnErrorReason = 'error' | 'interrupted' | 'aborted' | 'timeout'

export interface TurnError {
  reason: TurnErrorReason
  message: string
  code?: string
  cause?: unknown
}

export interface TurnPlugin {
  /** Optional name, used only for log messages. */
  name?: string

  /**
   * Called once before event consumption begins. Async. If this throws,
   * subsequent plugins' `onStart` are skipped, event consumption is
   * skipped, and the turn resolves with `reason='error'`. `onEnd` is still
   * called on every plugin regardless.
   */
  onStart?: (ctx: TurnContext) => void | Promise<void>

  /**
   * Called for every parsed `UniversalEvent`. Synchronous. The `rawData`
   * argument is the original JSON string (useful for broadcast plugins
   * that forward bytes verbatim). Exceptions are caught and logged.
   */
  onEvent?: (event: UniversalEvent, rawData: string) => void

  /**
   * Called in the error path only, before `onEnd`. Async. Typical use:
   * metrics, log. Business cleanup belongs in `onEnd`, not here.
   */
  onError?: (error: TurnError) => void | Promise<void>

  /**
   * Called exactly once per `runTurn` invocation, after everything else.
   * Async. This is where plugins flush write queues, release resources,
   * and finalize state. If this throws and `result.reason` was
   * `'completed'`, the result is downgraded to `'error'`.
   */
  onEnd?: (result: TurnResult) => void | Promise<void>
}

// ── Output ──

export type TurnReason = 'completed' | 'error' | 'interrupted' | 'aborted' | 'timeout'

export interface TurnResult {
  /**
   * The session id carried in the first `session.started` event. `null`
   * if the stream ended before any `session.started` arrived.
   */
  sessionId: string | null

  /** Final turn state. */
  reason: TurnReason

  /** Populated from `session.ended` when reason === 'completed'. */
  stats?: TurnStats

  /** Set whenever `reason !== 'completed'`. */
  error?: TurnError
}

// ── Internal ──

type AbortCause =
  | { kind: 'external' }
  | { kind: 'idle-timeout' }

// ── Entry ──

export async function runTurn(
  source: TurnSource,
  plugins: TurnPlugin[],
): Promise<TurnResult> {
  const idleTimeoutMs = source.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
  const hasIdleTimeout = idleTimeoutMs > 0 && Number.isFinite(idleTimeoutMs)

  // Internal controller combines external signal and idle timeout. We also
  // track *why* it aborted, so we can assign the correct reason later.
  const internalCtrl = new AbortController()
  let abortCause: AbortCause | null = null

  function triggerAbort(cause: AbortCause): void {
    if (abortCause) return
    abortCause = cause
    internalCtrl.abort()
  }

  const onExternalAbort = () => triggerAbort({ kind: 'external' })
  if (source.signal) {
    if (source.signal.aborted) {
      triggerAbort({ kind: 'external' })
    } else {
      source.signal.addEventListener('abort', onExternalAbort, { once: true })
    }
  }

  let idleTimer: ReturnType<typeof setTimeout> | null = null
  function resetIdleTimer(): void {
    if (!hasIdleTimeout) return
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => triggerAbort({ kind: 'idle-timeout' }), idleTimeoutMs)
  }
  function clearIdleTimer(): void {
    if (idleTimer) {
      clearTimeout(idleTimer)
      idleTimer = null
    }
  }

  // Turn-level state gathered from events.
  let sessionId: string | null = null
  let sessionStartedSeen = false
  let sessionEndedReason: 'completed' | 'error' | 'interrupted' | null = null
  let sessionEndedStats: TurnStats | undefined

  // Error collected from stream consumption (distinct from abortCause).
  let streamError: { message: string; cause?: unknown } | null = null

  // Whether plugin onStart succeeded for all plugins. If not, skip stream.
  let startFailed = false

  // Guard: reconnect is attempted at most once per runTurn invocation.
  let reconnectAttempted = false

  const ctx: TurnContext = { signal: source.signal }

  // Consume one Response end-to-end. Updates closed-over state in place.
  // Does not throw — all errors are captured into `streamError` (unless
  // `abortCause` already set, in which case abort semantics take over).
  async function consume(response: Response): Promise<void> {
    try {
      for await (const raw of readSSE(response, { signal: internalCtrl.signal })) {
        resetIdleTimer()

        const evt = parseEvent(raw.data)

        // Lifecycle tracking
        if (evt.type === 'session.started' && typeof evt.session_id === 'string') {
          if (!sessionStartedSeen) {
            sessionId = evt.session_id
            sessionStartedSeen = true
          } else if (sessionId !== evt.session_id) {
            console.warn(
              `[runTurn] later session.started with different id: ${sessionId} → ${evt.session_id}, ignored`,
            )
          }
        } else if (evt.type === 'session.ended') {
          sessionEndedReason = normalizeEndedReason(evt.reason)
          sessionEndedStats = evt.stats
        }

        // Dispatch to plugins (sync, errors isolated)
        for (const p of plugins) {
          if (!p.onEvent) continue
          try {
            p.onEvent(evt, raw.data)
          } catch (e) {
            console.error(
              `[runTurn] plugin ${p.name ?? 'unnamed'} onEvent error:`,
              e,
            )
          }
        }
      }
    } catch (e) {
      if (!abortCause) {
        streamError = { message: (e as Error)?.message ?? String(e), cause: e }
      }
    }
  }

  // 1. onStart
  for (const p of plugins) {
    if (!p.onStart) continue
    try {
      await p.onStart(ctx)
    } catch (e) {
      startFailed = true
      streamError = {
        message: `plugin ${p.name ?? 'unnamed'} onStart threw`,
        cause: e,
      }
      break
    }
  }

  // 2. Primary stream (skip if any onStart failed)
  if (!startFailed) {
    try {
      const response = await source.stream()
      resetIdleTimer()
      await consume(response)
    } catch (e) {
      if (!abortCause) {
        streamError = { message: (e as Error)?.message ?? String(e), cause: e }
      }
    }
  }

  // 3. Reconnect path — at most once, not triggered by abort or timeout.
  const shouldReconnect =
    source.reconnect !== undefined &&
    !reconnectAttempted &&
    !abortCause &&
    !sessionEndedReason &&
    !startFailed
  if (shouldReconnect) {
    reconnectAttempted = true
    const primaryError = streamError
    console.log(
      `[runTurn] primary stream did not reach session.ended (${primaryError?.message ?? 'clean close'}), attempting reconnect`,
    )
    // Clear primary error — if reconnect recovers cleanly, the turn is
    // 'completed' from L1's POV. If reconnect also fails, we overwrite
    // streamError with its own failure below.
    streamError = null
    try {
      const reconnectResponse = await source.reconnect!()
      if (reconnectResponse === null) {
        console.log(`[runTurn] reconnect source returned null, giving up`)
        streamError = primaryError
      } else {
        resetIdleTimer()
        await consume(reconnectResponse)
        if (sessionEndedReason) {
          console.log(
            `[runTurn] reconnect recovered turn session=${sessionId} reason=${sessionEndedReason}`,
          )
        } else if (!abortCause) {
          console.log(`[runTurn] reconnect stream also did not reach session.ended`)
          // If reconnect itself errored, `consume` set streamError. Otherwise
          // it closed cleanly without session.ended.
          if (!streamError) {
            streamError = {
              message: 'reconnect stream ended without session.ended',
              cause: primaryError?.cause,
            }
          }
        }
      }
    } catch (e) {
      console.error(`[runTurn] reconnect source threw:`, e)
      if (!abortCause) {
        streamError = {
          message: `reconnect source threw: ${(e as Error)?.message ?? String(e)}`,
          cause: e,
        }
      }
    }
  }

  clearIdleTimer()
  if (source.signal) {
    source.signal.removeEventListener('abort', onExternalAbort)
  }

  // 3. Build TurnResult
  let result = buildResult({
    sessionId,
    sessionEndedReason,
    sessionEndedStats,
    abortCause,
    streamError,
    idleTimeoutMs,
    startFailed,
  })

  // 4. onError (only in error paths)
  if (result.error) {
    for (const p of plugins) {
      if (!p.onError) continue
      try {
        await p.onError(result.error)
      } catch (e) {
        console.error(
          `[runTurn] plugin ${p.name ?? 'unnamed'} onError error:`,
          e,
        )
      }
    }
  }

  // 5. onEnd (always, in order). Exceptions downgrade 'completed' → 'error'.
  for (const p of plugins) {
    if (!p.onEnd) continue
    try {
      await p.onEnd(result)
    } catch (e) {
      console.error(
        `[runTurn] plugin ${p.name ?? 'unnamed'} onEnd error:`,
        e,
      )
      if (result.reason === 'completed') {
        result = {
          sessionId: result.sessionId,
          reason: 'error',
          error: {
            reason: 'error',
            message: `plugin ${p.name ?? 'unnamed'} onEnd threw`,
            cause: e,
          },
        }
      }
    }
  }

  return result
}

// ── Helpers ──

function parseEvent(rawData: string): UniversalEvent {
  try {
    const parsed = JSON.parse(rawData)
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as { type?: unknown }).type === 'string'
    ) {
      return parsed as UniversalEvent
    }
    return synthesizeParseError('invalid shape')
  } catch (e) {
    return synthesizeParseError((e as Error)?.message ?? 'unknown')
  }
}

function synthesizeParseError(reason: string): UniversalEvent {
  return {
    type: 'error',
    timestamp: Date.now(),
    message: `failed to parse event data: ${reason}`,
    code: 'parse_error',
  }
}

function normalizeEndedReason(
  raw: unknown,
): 'completed' | 'error' | 'interrupted' {
  if (raw === 'error' || raw === 'interrupted') return raw
  return 'completed'
}

interface BuildResultInput {
  sessionId: string | null
  sessionEndedReason: 'completed' | 'error' | 'interrupted' | null
  sessionEndedStats: TurnStats | undefined
  abortCause: AbortCause | null
  streamError: { message: string; cause?: unknown } | null
  idleTimeoutMs: number
  startFailed: boolean
}

function buildResult(input: BuildResultInput): TurnResult {
  const {
    sessionId,
    sessionEndedReason,
    sessionEndedStats,
    abortCause,
    streamError,
    idleTimeoutMs,
    startFailed,
  } = input

  if (sessionEndedReason === 'completed') {
    return { sessionId, reason: 'completed', stats: sessionEndedStats }
  }

  if (sessionEndedReason === 'interrupted') {
    return {
      sessionId,
      reason: 'interrupted',
      stats: sessionEndedStats,
      error: {
        reason: 'interrupted',
        message: 'session ended with reason=interrupted',
      },
    }
  }

  if (sessionEndedReason === 'error') {
    return {
      sessionId,
      reason: 'error',
      stats: sessionEndedStats,
      error: {
        reason: 'error',
        message: 'session ended with reason=error',
      },
    }
  }

  // No session.ended seen.

  if (startFailed) {
    return {
      sessionId,
      reason: 'error',
      error: {
        reason: 'error',
        message: streamError?.message ?? 'plugin onStart threw',
        cause: streamError?.cause,
      },
    }
  }

  if (abortCause?.kind === 'external') {
    return {
      sessionId,
      reason: 'aborted',
      error: { reason: 'aborted', message: 'aborted by external signal' },
    }
  }

  if (abortCause?.kind === 'idle-timeout') {
    return {
      sessionId,
      reason: 'timeout',
      error: {
        reason: 'timeout',
        message: `idle timeout after ${idleTimeoutMs}ms`,
      },
    }
  }

  // Stream closed cleanly or threw without reaching session.ended.
  return {
    sessionId,
    reason: 'error',
    error: {
      reason: 'error',
      message: streamError?.message ?? 'stream ended without session.ended',
      cause: streamError?.cause,
    },
  }
}
