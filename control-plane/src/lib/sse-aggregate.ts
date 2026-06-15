import type { UniversalEvent } from '../../../internal/types/events'

interface AggregatedTurn {
  sessionId: string | null
  finalMessage: string
  stats: unknown | null
  reason: 'ended' | 'timeout' | 'error' | 'disconnected'
  error: string | null
  /** Timestamp at which aggregation began — used to filter persisted messages for the turn. */
  startedAt: number
}

/**
 * Drain a UniversalEvent SSE stream into a single aggregated turn summary.
 * Used by routes that want to expose JSON-mode chat (block until done,
 * return the final message + session id + stats in one response).
 */
export async function aggregateChatStream(response: Response): Promise<AggregatedTurn> {
  const out: AggregatedTurn = {
    sessionId: null,
    finalMessage: '',
    stats: null,
    reason: 'disconnected',
    error: null,
    startedAt: Date.now(),
  }
  if (!response.body) return out

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        let evt: UniversalEvent
        try {
          evt = JSON.parse(line.slice(6))
        } catch {
          continue
        }
        switch (evt.type) {
          case 'session.started':
            if (typeof evt.session_id === 'string') out.sessionId = evt.session_id
            break
          case 'item.completed': {
            const item = evt.item
            if (item?.kind === 'message' && item.role === 'assistant') {
              for (const part of item.content ?? []) {
                if (part.type === 'text' && typeof part.text === 'string') {
                  out.finalMessage += part.text
                }
              }
            }
            break
          }
          case 'session.ended':
            out.stats = (evt as UniversalEvent).stats ?? null
            out.reason = (evt as UniversalEvent).reason === 'error' ? 'error' : 'ended'
            break
          case 'error':
            out.reason = 'error'
            out.error = String((evt as UniversalEvent).message ?? 'unknown')
            break
        }
      }
    }
  } catch (e: any) {
    out.reason = 'error'
    out.error = e?.message ?? String(e)
  }

  return out
}

/**
 * For async chat: read the intercepted SSE stream only until `session.started`
 * to capture the (possibly newly-minted) session id, then detach. The turn
 * keeps running and persisting server-side — `createInterceptedSSEResponse`
 * drives persistence off the agent stream, not off this client body, so
 * cancelling here is exactly the decoupling `drainPendingMessage` relies on.
 *
 * `knownSessionId` short-circuits the wait for resumed sessions, whose id is
 * already known before dispatch. For a new session we wait for the first
 * frame (`session.started`), bounded by `timeoutMs` so a stuck agent can't hang
 * the request. The bound is generous because several sessions cold-starting in
 * the same workspace at once (e.g. a fan-out of sub-agents) can delay
 * `session.started` well past a tight timeout — and a premature timeout drops
 * the id for a session that is in fact starting and will run to completion.
 */
export async function awaitSessionId(
  response: Response,
  knownSessionId: string | null,
  timeoutMs = 300_000,
): Promise<{ sessionId: string | null; error: string | null }> {
  if (knownSessionId) {
    void response.body?.cancel().catch(() => {})
    return { sessionId: knownSessionId, error: null }
  }
  if (!response.body) return { sessionId: null, error: 'agent produced no stream' }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const deadline = Date.now() + timeoutMs

  const detach = () => {
    void reader.cancel().catch(() => {})
  }

  try {
    while (Date.now() < deadline) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        let evt: UniversalEvent
        try {
          evt = JSON.parse(line.slice(6))
        } catch {
          continue
        }
        if (evt.type === 'session.started' && typeof evt.session_id === 'string') {
          detach()
          return { sessionId: evt.session_id, error: null }
        }
        if (evt.type === 'error') {
          detach()
          return { sessionId: null, error: String((evt as UniversalEvent).message ?? 'unknown') }
        }
      }
    }
  } catch (e: any) {
    detach()
    return { sessionId: null, error: e?.message ?? String(e) }
  }
  detach()
  return { sessionId: null, error: 'session.started not received before timeout' }
}
