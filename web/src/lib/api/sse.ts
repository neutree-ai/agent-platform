import { i18n } from '@/lib/i18n'
import { type TurnPlugin, runTurn } from '@neutree-ai/sse-consumer'
import type { AskUserQuestionItem, AskUserRequest, ChatImageAttachment, TurnStats } from './types'

// ── UniversalEvent content types ──
//
// Kept here (rather than re-exported from `@neutree-ai/types`) because web stores
// import these names directly and use them to shape Zustand state.

export interface ContentDelta {
  type: 'text' | 'reasoning'
  text: string
}

interface ContentPart {
  type: 'text' | 'tool_call' | 'tool_result' | 'reasoning' | 'status'
  text?: string
  call_id?: string
  name?: string
  arguments?: string
  output?: string
  is_error?: boolean
  label?: string
  detail?: string
}

export interface UniversalItem {
  item_id: string
  kind: 'message' | 'tool_call' | 'tool_result' | 'status'
  role: 'user' | 'assistant' | 'tool' | null
  status: 'in_progress' | 'completed' | 'failed'
  content: ContentPart[]
  parent_tool_use_id?: string | null
}

// ── SSE handler bag ──

type AgentSSEHandler = {
  /** Override the chat endpoint URL (e.g. for system workspaces). */
  chatEndpoint?: string
  onSessionStarted?: (sessionId: string) => void
  onSessionEnded?: (sessionId: string, reason: string, stats?: TurnStats) => void
  onItemStarted?: (item: UniversalItem) => void
  onItemDelta?: (itemId: string, delta: ContentDelta) => void
  onItemCompleted?: (item: UniversalItem) => void
  onQuestionRequested?: (request: AskUserRequest) => void
  onError?: (error: string) => void
}

// ── Handler → TurnPlugin adapter ──
//
// Translates the per-event `AgentSSEHandler` shape into a `TurnPlugin` for
// `runTurn`. `onError` surfaces turn-level failures (upstream error,
// premature close, parse failure synthesized as `{type:'error'}`), but is
// suppressed when:
//   - `session.ended` already delivered a terminal status,
//   - a server-sent (or synthesized) `error` event already fired, or
//   - the turn was cancelled by the caller's `AbortSignal`.

function handlersToPlugin(
  handlers: AgentSSEHandler,
  getActiveSessionId?: () => string | null | undefined,
): TurnPlugin {
  let sessionEndedDispatched = false
  let errorDispatched = false
  return {
    name: 'web-handlers',
    onEvent: (evt) => {
      // CP reconnect is session-scoped (the `session_id` query param picks the
      // caller's own turn), so the stream should only ever carry the active
      // session. This filter stays as defense-in-depth — it also covers the
      // legacy workspace-wide fallback — dropping any stray event whose
      // session_id doesn't match the one the user is currently viewing.
      const active = getActiveSessionId?.()
      if (active && evt.session_id && evt.session_id !== active) return
      switch (evt.type) {
        case 'session.started':
          if (typeof evt.session_id === 'string') {
            handlers.onSessionStarted?.(evt.session_id)
          }
          break
        case 'session.ended':
          sessionEndedDispatched = true
          handlers.onSessionEnded?.(
            evt.session_id || '',
            (evt.reason as string | undefined) || i18n.t('session.status.completed'),
            evt.stats as TurnStats | undefined,
          )
          break
        case 'item.started':
          if (evt.item) handlers.onItemStarted?.(evt.item as unknown as UniversalItem)
          break
        case 'item.delta':
          if (evt.item_id && evt.delta) {
            handlers.onItemDelta?.(evt.item_id, evt.delta as unknown as ContentDelta)
          }
          break
        case 'item.completed':
          if (evt.item) handlers.onItemCompleted?.(evt.item as unknown as UniversalItem)
          break
        case 'question.requested':
          if (evt.request_id && evt.questions) {
            handlers.onQuestionRequested?.({
              requestId: evt.request_id,
              questions: evt.questions as unknown as AskUserQuestionItem[],
            })
          }
          break
        case 'error':
          errorDispatched = true
          handlers.onError?.(evt.message || i18n.t('common.errors.unknown'))
          break
      }
    },
    onError: async (err) => {
      if (sessionEndedDispatched) return
      if (errorDispatched) return
      if (err.reason === 'aborted') return
      handlers.onError?.(err.message)
    },
  }
}

function consumeStream(
  response: Response,
  handlers: AgentSSEHandler,
  signal: AbortSignal | undefined,
  getActiveSessionId?: () => string | null | undefined,
  reconnect?: () => Promise<Response | null>,
): Promise<void> {
  return runTurn(
    {
      stream: async () => response,
      reconnect,
      signal,
      // Web preserves existing behaviour: no automatic idle timeout. User
      // cancellation and session.ended are the only terminators.
      idleTimeoutMs: 0,
    },
    [handlersToPlugin(handlers, getActiveSessionId)],
  ).then(() => undefined)
}

// ── Reconnect factory ──
//
// `sse-consumer` calls `reconnect` **at most once** per `runTurn`. To get
// exponential backoff across multiple attempts we loop inside the factory
// itself, sleeping between tries. Each attempt re-POSTs `/cp-reconnect` for
// the current active session; the first 2xx Response is returned to
// `runTurn`, which then resumes streaming as if it were the primary source.
//
// Returns `null` if there's no session id yet, the signal aborts, or all
// retries return non-2xx (cp confirms the turn is no longer live). The
// surrounding `runTurn` then falls through to its error path and the web
// `onError` handler surfaces it.

const RECONNECT_BASE_DELAY_MS = 500
const RECONNECT_MAX_DELAY_MS = 8_000
const RECONNECT_MAX_ATTEMPTS = 5

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function buildCPReconnectFactory(
  workspaceId: string,
  signal: AbortSignal | undefined,
  getActiveSessionId?: () => string | null | undefined,
): () => Promise<Response | null> {
  return async () => {
    for (let attempt = 0; attempt < RECONNECT_MAX_ATTEMPTS; attempt++) {
      if (signal?.aborted) return null
      if (attempt > 0) {
        const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** (attempt - 1), RECONNECT_MAX_DELAY_MS)
        await sleep(delay, signal)
        if (signal?.aborted) return null
      }
      const sessionId = getActiveSessionId?.()
      if (!sessionId) {
        // The primary stream never delivered `session.started` — no live
        // session to reattach to.
        return null
      }
      const url = `/_proxy/agent/${workspaceId}/cp-reconnect?session_id=${encodeURIComponent(sessionId)}`
      try {
        const response = await fetch(url, {
          method: 'POST',
          credentials: 'include',
          signal,
        })
        if (response.ok) return response
        // Non-2xx means cp has no live stream for this session — the turn
        // already ended. Don't keep retrying.
        return null
      } catch (err) {
        if ((err as Error).name === 'AbortError') return null
        // Network blip — keep trying until the budget runs out.
        console.warn(
          `[sse] cp-reconnect attempt ${attempt + 1}/${RECONNECT_MAX_ATTEMPTS} failed:`,
          (err as Error).message,
        )
      }
    }
    return null
  }
}

// ── SSE stream initiators ──

export function createAgentChat(
  workspaceId: string,
  message: string,
  sessionId: string | undefined,
  handlers: AgentSSEHandler,
  signal?: AbortSignal,
  images?: ChatImageAttachment[],
): void {
  const endpoint = handlers.chatEndpoint || `/api/workspaces/${workspaceId}/chat`
  // Captures the session id as soon as `session.started` arrives, so the
  // reconnect factory can target `/cp-reconnect?session_id=...` even though
  // the initial POST didn't know the id yet. Wraps the caller's
  // `onSessionStarted` rather than replacing it.
  let liveSessionId: string | null = sessionId ?? null
  const wrappedHandlers: AgentSSEHandler = {
    ...handlers,
    onSessionStarted: (sid) => {
      liveSessionId = sid
      handlers.onSessionStarted?.(sid)
    },
  }
  void (async () => {
    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          session_id: sessionId ?? null,
          source: 'web',
          ...(images?.length ? { images } : {}),
        }),
        credentials: 'include',
        signal,
      })
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        handlers.onError?.((err as Error).message || i18n.t('common.errors.connectionFailed'))
      }
      return
    }
    if (!response.ok) {
      const body = await response
        .json()
        .catch(() => ({ error: i18n.t('common.errors.requestFailed') }))
      handlers.onError?.(body.error || i18n.t('common.errors.requestFailed'))
      return
    }
    const reconnect = buildCPReconnectFactory(workspaceId, signal, () => liveSessionId)
    await consumeStream(response, wrappedHandlers, signal, () => liveSessionId, reconnect)
  })()
}

/**
 * Reconnect to an active SSE stream at the CP level.
 *
 * Used after page refresh when chat_status is 'agent' — attaches as a live
 * client to continue the in-flight turn (persisted history is loaded from
 * the DB separately). The `session_id` query param scopes the reconnect to
 * this session's own turn, since a workspace can run several concurrently.
 */
export function createCPReconnectStream(
  workspaceId: string,
  handlers: AgentSSEHandler,
  signal?: AbortSignal,
  getActiveSessionId?: () => string | null | undefined,
): void {
  void (async () => {
    let response: Response
    const sessionId = getActiveSessionId?.()
    const url = sessionId
      ? `/_proxy/agent/${workspaceId}/cp-reconnect?session_id=${encodeURIComponent(sessionId)}`
      : `/_proxy/agent/${workspaceId}/cp-reconnect`
    try {
      response = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        signal,
      })
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        handlers.onError?.((err as Error).message || i18n.t('session.errors.cpReconnectFailed'))
      }
      return
    }
    // Non-2xx means CP has no live stream for this workspace — the turn has
    // already ended. Surface it as a terminal `disconnected` status.
    if (!response.ok) {
      handlers.onSessionEnded?.('', i18n.t('session.status.disconnected'))
      return
    }
    const reconnect = buildCPReconnectFactory(workspaceId, signal, getActiveSessionId)
    await consumeStream(response, handlers, signal, getActiveSessionId, reconnect)
  })()
}
