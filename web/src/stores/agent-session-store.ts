/**
 * Agent Session Store — manages chat/session lifecycle for a workspace.
 *
 * Design goals:
 *   1. Single source of truth for messages, loading state, SSE connections
 *   2. Lifecycle anchored to workspace page, not to ChatPanel mount/unmount
 *   3. No fragile useEffects — session switching is an explicit action
 *   4. Fully unit-testable via dependency injection
 *
 * Built on zustand/vanilla createStore for React-compatible subscribe/getSnapshot.
 */

import type { ContentDelta, UniversalItem } from '@/lib/api/sse'
import type {
  ApiContentPart,
  ApiMessage,
  AskUserRequest,
  ChatImageAttachment,
  ContextGauge,
  PendingMessage,
  TurnStats,
} from '@/lib/api/types'
import { i18n } from '@/lib/i18n'
import { createToolResultDispatcher } from '@/plugins/registry'
import { type StoreApi, createStore } from 'zustand/vanilla'
import { clearDraftFor, getDraftFor } from './draft-store'

// ── UI types ──

export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
  result?: string | object
  isError?: boolean
  startedAt?: number
  completedAt?: number
  resultAt?: number
  parentToolUseId?: string | null
}

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool'; tool: ToolCall }
  | { type: 'status'; label: string; detail?: string; isError?: boolean }
  | { type: 'image'; data: string; media_type: string }

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  blocks: ContentBlock[]
  isStreaming?: boolean
  created_at?: string
}

// ── Injectable dependencies ──

export interface AgentSessionApi {
  getWorkspaceMessages(workspaceId: string, sessionId: string): Promise<ApiMessage[]>
  getSession(
    workspaceId: string,
    sessionId: string,
  ): Promise<{ chat_status: string; pending_message: PendingMessage | null }>
  setPendingMessage(workspaceId: string, sessionId: string, msg: PendingMessage): Promise<void>
  clearPendingMessage(workspaceId: string, sessionId: string): Promise<void>
  getPendingQuestion(workspaceId: string, sessionId: string): Promise<AskUserRequest | null>
  respondToQuestion(
    workspaceId: string,
    sessionId: string,
    requestId: string,
    answers: Record<string, string>,
  ): Promise<void>
  interruptSession(
    workspaceId: string,
    sessionId: string,
  ): Promise<{ success: boolean; interrupted?: boolean }>
  deleteSession(workspaceId: string, sessionId: string): Promise<void>
}

export interface AgentSessionSSE {
  createAgentChat(
    workspaceId: string,
    message: string,
    sessionId: string | undefined,
    handlers: SSEHandlers,
    signal: AbortSignal,
    images?: ChatImageAttachment[],
  ): void
  createCPReconnectStream(
    workspaceId: string,
    handlers: SSEHandlers,
    signal: AbortSignal,
    getActiveSessionId?: () => string | null | undefined,
  ): void
}

export interface SSEHandlers {
  chatEndpoint?: string
  onSessionStarted?: (sessionId: string) => void
  onSessionEnded?: (sessionId: string, reason: string, stats?: TurnStats) => void
  onItemStarted?: (item: UniversalItem) => void
  onItemDelta?: (itemId: string, delta: ContentDelta) => void
  onItemCompleted?: (item: UniversalItem) => void
  onQuestionRequested?: (request: AskUserRequest) => void
  onError?: (error: string) => void
}

export interface AgentSessionEffects {
  onSessionCreated(sessionId: string): void
  onTurnComplete(): void
  invalidateSessions(workspaceId: string): void
  invalidateWorkspaces(): void
}

export interface AgentSessionDeps {
  api: AgentSessionApi
  sse: AgentSessionSSE
  effects: AgentSessionEffects
}

// ── Store state & actions ──

interface AgentSessionState {
  workspaceId: string
  activeSessionId: string | undefined
  /**
   * The session id whose data is currently in `messages` etc. — set after a
   * successful history load, or after sendMessage creates a session live.
   * `switchSession(id)` early-exits when `id === loadedSessionId`, since the
   * in-memory state is already coherent with that session.
   */
  loadedSessionId: string | undefined
  messages: ChatMessage[]
  isLoading: boolean
  isSwitching: boolean
  isDeleting: boolean
  error: string | null
  pendingQuestion: AskUserRequest | null
  lastTurnStats: ContextGauge | null
  isBusy: boolean
  /**
   * A follow-up message the user typed while a turn was running. The current
   * turn keeps streaming; when it ends cleanly cp drains this into a fresh
   * turn. Single draft — re-sending while busy newline-merges into it.
   */
  pendingMessage: PendingMessage | null
}

interface AgentSessionActions {
  switchSession(sessionId: string | undefined, context?: SwitchSessionContext): Promise<void>
  sendMessage(content: string, images?: ChatImageAttachment[]): void
  /**
   * Fire-and-forget chat dispatch to a specific session in this workspace,
   * even when it isn't the currently active one. When `sessionId` equals the
   * active session this behaves exactly like `sendMessage`; otherwise the
   * HTTP /chat request is issued, the SSE stream is drained server-side via
   * cp's persist plugin, and the local store is left untouched — the user
   * will see the new exchange next time they switch to that session.
   *
   * Used by plugin UIs that need to wake a particular session (e.g. a code
   * review plugin submitting against the originating chat regardless of
   * which chat the user is viewing now).
   */
  sendMessageToSession(sessionId: string, content: string, images?: ChatImageAttachment[]): void
  /**
   * Promote the current composer text (and any attached images) to the
   * session's queued follow-up (replacing any existing draft) and persist it.
   * Invoked by a submit while a turn is running. Omitting `images` preserves
   * whatever images are already queued (so a text-only re-arm keeps them).
   */
  updatePendingMessage(content: string, images?: ChatImageAttachment[]): void
  /** Discard the queued draft. */
  clearPendingMessage(): void
  respondToQuestion(answers: Record<string, string>): Promise<void>
  stop(): Promise<void>
  abortStream(): void
  deleteSession(): Promise<void>
  reconnect(): void
  /** Load pre-fetched history into the store. */
  loadHistory(history: ApiMessage[], stats?: ContextGauge | null): void
  /** Clear all messages and errors. */
  clearMessages(): void
  destroy(): void
}

interface SwitchSessionContext {
  sessionChatStatus?: string
  lastTurnStats?: ContextGauge | null
}

export type AgentSessionSlice = AgentSessionState & AgentSessionActions

// ── Helpers ──

let _id = 0
function genId(): string {
  return `msg-${Date.now()}-${++_id}`
}

export function toChatMessage(message: ApiMessage): ChatMessage {
  const blocks: ContentBlock[] = []
  const parts = (Array.isArray(message.blocks) ? message.blocks : []) as ApiContentPart[]
  const resultMap = new Map<string, { output: string; is_error?: boolean; timestamp?: number }>()
  for (const p of parts) {
    if (p.type === 'tool_result') {
      resultMap.set(p.call_id, {
        output: p.output,
        is_error: p.is_error,
        timestamp: (p as any).timestamp,
      })
    }
  }
  for (const part of parts) {
    if (part.type === 'text') {
      blocks.push({ type: 'text', text: part.text })
    } else if (part.type === 'image') {
      blocks.push({ type: 'image', data: (part as any).data, media_type: (part as any).media_type })
    } else if (part.type === 'tool_call') {
      const result = resultMap.get(part.call_id)
      let input: Record<string, unknown> = {}
      try {
        input = JSON.parse(part.arguments)
      } catch {}
      blocks.push({
        type: 'tool',
        tool: {
          id: part.call_id,
          name: part.name ?? i18n.t('components.chat.toolRenderers.labels.unknown'),
          input,
          result: result?.output,
          isError: result?.is_error,
          startedAt: (part as any).started_at,
          completedAt: (part as any).completed_at,
          resultAt: result?.timestamp,
          parentToolUseId: (part as any).parent_tool_use_id ?? null,
        },
      })
    }
  }
  return {
    id: String(message.id),
    role: message.role,
    content: message.content,
    blocks,
    created_at: message.created_at,
  }
}

// ── Factory ──

export function createAgentSessionStore(
  workspaceId: string,
  deps: AgentSessionDeps,
  options?: { chatEndpoint?: string },
): StoreApi<AgentSessionSlice> {
  let abortController: AbortController | null = null
  let switchVersion = 0

  const toolDispatcher = createToolResultDispatcher()

  function abortActiveStream() {
    abortController?.abort()
    abortController = null
    switchVersion++
  }

  function newAbortController(): AbortController {
    abortActiveStream()
    abortController = new AbortController()
    return abortController
  }

  /** Start a CP reconnect stream, reusing the last assistant message or creating a placeholder. */
  function startReconnect() {
    const msgs = store.getState().messages
    const last = msgs[msgs.length - 1]
    let assistantId: string
    if (last?.role === 'assistant') {
      assistantId = last.id
      store.setState({
        isLoading: true,
        isBusy: true,
        messages: msgs.map((m, i) => (i === msgs.length - 1 ? { ...m, isStreaming: true } : m)),
      })
    } else {
      assistantId = genId()
      store.setState({
        isLoading: true,
        isBusy: true,
        messages: [
          ...msgs,
          {
            id: assistantId,
            role: 'assistant' as const,
            content: '',
            blocks: [],
            isStreaming: true,
          },
        ],
      })
    }
    const ac = newAbortController()
    deps.sse.createCPReconnectStream(
      workspaceId,
      buildSSEHandlers(assistantId, switchVersion),
      ac.signal,
      () => store.getState().activeSessionId,
    )
  }

  // cp drains a queued follow-up asynchronously after `session.ended`; these
  // bound the poll that waits for the drained turn to register (~10s total).
  // The poll exits early as soon as the drained turn goes live, so a wider
  // interval only delays detection slightly while cutting the request burst.
  const PENDING_FOLLOW_INTERVAL_MS = 1200
  const PENDING_FOLLOW_MAX_ATTEMPTS = 8

  /**
   * After a turn ends with a queued follow-up, cp dispatches the next turn on
   * its own. Poll the session until that turn is live (`chat_status` flips
   * back to `agent`), then reload history — cp-reconnect replays nothing, the
   * browser owns history — and attach for live events. If it never goes live
   * (drain failed, or the turn finished faster than the poll), settle on the
   * freshest server state.
   *
   * `drainedContent` is the text cp drained into the new turn. Once the turn
   * is confirmed live it is cleared from the composer — but only if the
   * composer still holds exactly that text (a user edit since queueing wins).
   */
  async function followPendingTurn(drainedContent: string) {
    const sessionId = store.getState().activeSessionId
    if (!sessionId) {
      store.setState({ isLoading: false, isBusy: false })
      return
    }
    const version = switchVersion
    for (let attempt = 0; attempt < PENDING_FOLLOW_MAX_ATTEMPTS; attempt++) {
      await new Promise((r) => setTimeout(r, PENDING_FOLLOW_INTERVAL_MS))
      if (version !== switchVersion) return // user navigated away
      let detail: { chat_status: string; pending_message: PendingMessage | null }
      try {
        detail = await deps.api.getSession(workspaceId, sessionId)
      } catch {
        continue
      }
      if (version !== switchVersion) return
      if (detail.chat_status === 'agent') {
        if (getDraftFor(workspaceId, sessionId) === drainedContent) {
          clearDraftFor(workspaceId, sessionId)
        }
        try {
          const history = await deps.api.getWorkspaceMessages(workspaceId, sessionId)
          if (version !== switchVersion) return
          store.setState({ messages: history.map(toChatMessage), loadedSessionId: sessionId })
        } catch {
          // History reload failed — startReconnect still attaches live events.
        }
        startReconnect()
        return
      }
    }
    // The follow-up turn never went live. Reload the final state and settle;
    // a restored draft (drain failed) reappears as the pending bubble.
    if (version !== switchVersion) return
    try {
      const [history, latest] = await Promise.all([
        deps.api.getWorkspaceMessages(workspaceId, sessionId),
        deps.api.getSession(workspaceId, sessionId),
      ])
      if (version !== switchVersion) return
      store.setState({
        messages: history.map(toChatMessage),
        loadedSessionId: sessionId,
        pendingMessage: latest.pending_message,
        isLoading: false,
        isBusy: false,
      })
    } catch {
      if (version === switchVersion) store.setState({ isLoading: false, isBusy: false })
    }
  }

  /**
   * Apply a new pending-message value to the store and mirror it to the
   * server (a null value clears the draft). Skips the server call when there
   * is no session id yet — `onSessionStarted` flushes the draft once the
   * session row exists.
   */
  function persistPendingMessage(next: PendingMessage | null) {
    store.setState({ pendingMessage: next })
    const sessionId = store.getState().activeSessionId
    if (!sessionId) return
    const op = next
      ? deps.api.setPendingMessage(workspaceId, sessionId, next)
      : deps.api.clearPendingMessage(workspaceId, sessionId)
    op.catch((e) => console.warn('[agent-session] persist pending failed:', e))
  }

  // ── SSE handler factory ──
  // `streamVersion` is captured at call time; every handler early-returns if the
  // store has since switched sessions (switchVersion incremented). This prevents
  // buffered events from an aborted stream leaking into the newly-active session.

  function buildSSEHandlers(assistantId: string, streamVersion: number): SSEHandlers {
    const guard =
      <A extends unknown[]>(fn: (...args: A) => void) =>
      (...args: A) => {
        if (streamVersion !== switchVersion) return
        fn(...args)
      }
    return {
      chatEndpoint: options?.chatEndpoint,

      onSessionStarted: guard((sessionId) => {
        store.setState({ activeSessionId: sessionId, loadedSessionId: sessionId })
        deps.effects.onSessionCreated(sessionId)
        deps.effects.invalidateSessions(workspaceId)
        deps.effects.invalidateWorkspaces()
        // A draft armed before the session had an id couldn't be persisted —
        // flush it now that the session row exists.
        const pending = store.getState().pendingMessage
        if (pending) {
          deps.api
            .setPendingMessage(workspaceId, sessionId, pending)
            .catch((e) => console.warn('[agent-session] persist pending on start failed:', e))
        }
      }),

      onSessionEnded: guard((_sid, reason, stats) => {
        // A clean finish with a queued follow-up: cp drains it into a fresh
        // turn, so stay busy and follow that turn instead of going idle.
        const queued = store.getState().pendingMessage
        const draining = queued !== null && reason === 'completed'
        store.setState((s) => ({
          lastTurnStats: stats ?? s.lastTurnStats,
          pendingQuestion: null,
          pendingMessage: draining ? null : s.pendingMessage,
          messages: s.messages.map((m) =>
            m.id === assistantId ? { ...m, isStreaming: false } : m,
          ),
          isLoading: draining,
          isBusy: draining,
        }))
        deps.effects.invalidateSessions(workspaceId)
        deps.effects.invalidateWorkspaces()
        deps.effects.onTurnComplete()
        if (draining && queued) {
          // Clear the composer at drain time so the queued text doesn't linger
          // visually after `pendingMessage` is nulled — that gap lets a user
          // re-Queue the same content, which then gets drained a second time
          // at the next turn's end. Same "user edits since queueing win" rule
          // as followPendingTurn's success path: only clear if the draft still
          // matches the queued content. followPendingTurn's later clearDraftFor
          // becomes idempotent.
          const sid = store.getState().activeSessionId
          if (sid && getDraftFor(workspaceId, sid) === queued.content) {
            clearDraftFor(workspaceId, sid)
          }
          void followPendingTurn(queued.content)
        }
      }),

      onItemStarted: guard((item) => {
        if (item.kind === 'tool_call') {
          const tc = item.content?.[0]
          if (tc?.type === 'tool_call') {
            store.setState((s) => ({
              messages: s.messages.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      blocks: [
                        ...m.blocks,
                        {
                          type: 'tool' as const,
                          tool: {
                            id: tc.call_id!,
                            name: tc.name ?? i18n.t('components.chat.toolRenderers.labels.unknown'),
                            input: {},
                            startedAt: Date.now(),
                            parentToolUseId: item.parent_tool_use_id ?? null,
                          },
                        },
                      ],
                    }
                  : m,
              ),
            }))
          }
        }
      }),

      onItemDelta: guard((_itemId, delta) => {
        if (delta.type === 'text') {
          store.setState((s) => ({
            messages: s.messages.map((m) => {
              if (m.id !== assistantId) return m
              const blocks = [...m.blocks]
              const last = blocks[blocks.length - 1]
              if (last?.type === 'text') {
                blocks[blocks.length - 1] = { type: 'text', text: last.text + delta.text }
              } else {
                blocks.push({ type: 'text', text: delta.text })
              }
              return { ...m, content: m.content + delta.text, blocks }
            }),
          }))
        }
      }),

      onItemCompleted: guard((item) => {
        // Finalize assistant text — item.completed is the authoritative final content,
        // replace whatever deltas accumulated with the complete text.
        if (item.kind === 'message' && item.role === 'assistant') {
          const fullText = (item.content || [])
            .filter((p) => p.type === 'text' && p.text)
            .map((p) => p.text!)
            .join('')
          if (fullText) {
            store.setState((s) => ({
              messages: s.messages.map((m) => {
                if (m.id !== assistantId) return m
                const blocks = [...m.blocks]
                let lastTextIdx = -1
                for (let i = blocks.length - 1; i >= 0; i--) {
                  if (blocks[i].type === 'text') {
                    lastTextIdx = i
                    break
                  }
                }
                // The trailing text block is the streaming buffer for this completed
                // message item — replace it with the authoritative text. Earlier text
                // blocks belong to prior message items in the same turn; leave them.
                if (lastTextIdx >= 0 && blocks.length - 1 === lastTextIdx) {
                  blocks[lastTextIdx] = { type: 'text', text: fullText }
                } else {
                  blocks.push({ type: 'text', text: fullText })
                }
                const newContent = blocks
                  .filter((b) => b.type === 'text')
                  .map((b) => (b as { type: 'text'; text: string }).text)
                  .join('')
                return { ...m, content: newContent, blocks }
              }),
            }))
          }
        }

        if (item.kind === 'tool_call') {
          const tc = item.content?.[0]
          if (tc?.type === 'tool_call') {
            let input: Record<string, unknown> = {}
            try {
              input = JSON.parse(tc.arguments || '{}')
            } catch {}
            store.setState((s) => ({
              messages: s.messages.map((m) => {
                if (m.id !== assistantId) return m
                const idx = m.blocks.findIndex((b) => b.type === 'tool' && b.tool.id === tc.call_id)
                if (idx >= 0) {
                  const blocks = [...m.blocks]
                  const b = blocks[idx] as ContentBlock & { type: 'tool' }
                  blocks[idx] = {
                    type: 'tool',
                    tool: { ...b.tool, input, completedAt: Date.now() },
                  }
                  return { ...m, blocks }
                }
                return {
                  ...m,
                  blocks: [
                    ...m.blocks,
                    {
                      type: 'tool' as const,
                      tool: {
                        id: tc.call_id!,
                        name: tc.name ?? i18n.t('components.chat.toolRenderers.labels.unknown'),
                        input,
                        completedAt: Date.now(),
                        parentToolUseId: item.parent_tool_use_id ?? null,
                      },
                    },
                  ],
                }
              }),
            }))
          }
        }

        if (item.kind === 'tool_result') {
          const tr = item.content?.[0]
          if (tr?.type === 'tool_result') {
            let matchedTool: ToolCall | undefined
            store.setState((s) => {
              // Only the message containing the matching tool block needs a new ref;
              // other messages keep reference equality so React.memo can short-circuit.
              const messages = s.messages.map((m) => {
                const idx = m.blocks.findIndex((b) => b.type === 'tool' && b.tool.id === tr.call_id)
                if (idx < 0) return m
                const blocks = m.blocks.slice()
                const prev = blocks[idx] as ContentBlock & { type: 'tool' }
                blocks[idx] = {
                  ...prev,
                  tool: {
                    ...prev.tool,
                    result: tr.output,
                    isError: tr.is_error,
                    resultAt: Date.now(),
                  },
                }
                matchedTool = prev.tool
                return { ...m, blocks }
              })
              return { messages }
            })
            if (matchedTool) {
              toolDispatcher.dispatch({
                toolName: matchedTool.name,
                toolInput: matchedTool.input,
                toolOutput: tr.output ?? '',
                isError: !!tr.is_error,
                callId: tr.call_id ?? '',
                workspaceId,
              })
            }
          }
        }

        if (item.kind === 'status') {
          const part = item.content?.[0]
          if (part?.type === 'status') {
            store.setState((s) => ({
              messages: s.messages.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      blocks: [
                        ...m.blocks,
                        {
                          type: 'status' as const,
                          label: part.label!,
                          detail: part.detail,
                          isError: item.status === 'failed',
                        },
                      ],
                    }
                  : m,
              ),
            }))
          }
        }
      }),

      onQuestionRequested: guard((request) => {
        store.setState({ pendingQuestion: request })
      }),

      onError: guard((err) => {
        store.setState({ error: err, isLoading: false, isBusy: false })
      }),
    }
  }

  // ── Store ──

  const store = createStore<AgentSessionSlice>()(() => ({
    // State
    workspaceId,
    activeSessionId: undefined,
    loadedSessionId: undefined,
    messages: [],
    isLoading: false,
    isSwitching: false,
    isDeleting: false,
    error: null,
    pendingQuestion: null,
    lastTurnStats: null,
    isBusy: false,
    pendingMessage: null,

    // Actions
    async switchSession(sessionId, context) {
      const s = store.getState()
      // Already showing this session's data — no work to do. Covers both the
      // sendMessage round-trip (active-session-store sync calls back into us)
      // and the user re-selecting the current session from a dropdown.
      if (sessionId && sessionId === s.loadedSessionId) {
        if (s.activeSessionId !== sessionId) store.setState({ activeSessionId: sessionId })
        return
      }

      abortActiveStream()

      if (!sessionId) {
        store.setState({
          activeSessionId: undefined,
          loadedSessionId: undefined,
          messages: [],
          pendingQuestion: null,
          pendingMessage: null,
          isLoading: false,
          isSwitching: false,
          isBusy: false,
          error: null,
          lastTurnStats: null,
        })
        return
      }

      // Immediately clear old content and show loading
      store.setState({
        activeSessionId: sessionId,
        loadedSessionId: undefined,
        messages: [],
        pendingQuestion: null,
        pendingMessage: null,
        isLoading: false,
        isBusy: false,
        isSwitching: true,
        error: null,
        lastTurnStats: context?.lastTurnStats ?? null,
      })

      // Fetch history, pending question and the session row (for its queued
      // follow-up draft) in parallel
      const [historyResult, questionResult, sessionResult] = await Promise.allSettled([
        deps.api.getWorkspaceMessages(workspaceId, sessionId),
        deps.api.getPendingQuestion(workspaceId, sessionId),
        deps.api.getSession(workspaceId, sessionId),
      ])
      // Bail only if the active session has actually changed — e.g. another
      // `switchSession` call targeted a different session. A mere stream
      // abort (stop/destroy/StrictMode unmount) bumps `switchVersion` without
      // changing `activeSessionId`, and must not leave `isSwitching` stuck.
      if (store.getState().activeSessionId !== sessionId) return

      if (historyResult.status === 'rejected') {
        store.setState({
          error:
            historyResult.reason instanceof Error
              ? historyResult.reason.message
              : i18n.t('session.errors.loadHistoryFailed'),
          isSwitching: false,
        })
        return
      }

      store.setState({
        messages: historyResult.value.map(toChatMessage),
        pendingQuestion: questionResult.status === 'fulfilled' ? questionResult.value : null,
        pendingMessage:
          sessionResult.status === 'fulfilled' ? sessionResult.value.pending_message : null,
        isSwitching: false,
        loadedSessionId: sessionId,
      })

      if (context?.sessionChatStatus === 'agent') {
        startReconnect()
      }
    },

    sendMessage(content, images) {
      if (!content.trim()) return
      // A turn is already in flight — promote this to the queued follow-up
      // rather than dropping it or starting a concurrent turn.
      if (store.getState().isLoading) {
        store.getState().updatePendingMessage(content, images)
        return
      }

      const userBlocks: ContentBlock[] = [{ type: 'text', text: content.trim() }]
      if (images?.length) {
        for (const img of images) {
          userBlocks.push({ type: 'image', data: img.data, media_type: img.media_type })
        }
      }
      const userMessage: ChatMessage = {
        id: genId(),
        role: 'user',
        content: content.trim(),
        blocks: userBlocks,
      }

      const assistantId = genId()
      const assistantMessage: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        blocks: [],
        isStreaming: true,
      }

      store.setState((s) => ({
        error: null,
        isLoading: true,
        isBusy: true,
        messages: [...s.messages, userMessage, assistantMessage],
      }))

      const ac = newAbortController()
      deps.sse.createAgentChat(
        workspaceId,
        content.trim(),
        store.getState().activeSessionId,
        buildSSEHandlers(assistantId, switchVersion),
        ac.signal,
        images,
      )
    },

    sendMessageToSession(sessionId, content, images) {
      const text = content.trim()
      if (!text) return
      if (sessionId === store.getState().activeSessionId) {
        store.getState().sendMessage(content, images)
        return
      }
      // Off-screen dispatch — drain the stream server-side (cp's persist
      // plugin owns its own buffer; the HTTP body just needs to be consumed
      // so the server doesn't see a client disconnect mid-turn). Use an
      // independent AbortController so user actions on the active session
      // don't kill this one.
      const ac = new AbortController()
      deps.sse.createAgentChat(
        workspaceId,
        text,
        sessionId,
        {
          onError: (err) =>
            console.warn(`[agent-session] off-screen dispatch to ${sessionId} failed:`, err),
        },
        ac.signal,
        images,
      )
    },

    updatePendingMessage(content, images) {
      // An explicit images arg replaces the queued images; omitting it keeps
      // whatever is already queued (text-only re-arm).
      const nextImages = images ?? store.getState().pendingMessage?.images ?? []
      persistPendingMessage(
        content.trim() || nextImages.length > 0 ? { content, images: nextImages } : null,
      )
    },

    clearPendingMessage() {
      if (store.getState().pendingMessage === null) return
      persistPendingMessage(null)
    },

    async respondToQuestion(answers) {
      const { pendingQuestion, activeSessionId } = store.getState()
      if (!pendingQuestion || !activeSessionId) return
      store.setState({ pendingQuestion: null })
      try {
        await deps.api.respondToQuestion(
          workspaceId,
          activeSessionId,
          pendingQuestion.requestId,
          answers,
        )
      } catch (err) {
        store.setState({
          error: err instanceof Error ? err.message : i18n.t('session.errors.respondFailed'),
        })
      }
    },

    async stop() {
      const { activeSessionId } = store.getState()
      // Bootstrap window: no session id yet. The SSE is aborted client-side;
      // the agent notices the dropped connection and unwinds on its own.
      if (!activeSessionId) {
        abortActiveStream()
        store.setState({ isLoading: false, isBusy: false })
        return
      }
      try {
        const res = await deps.api.interruptSession(workspaceId, activeSessionId)
        if (res.interrupted === false) {
          // The turn is still starting up: the agent session was not yet
          // registered, so the interrupt found no target. Keep the stream
          // and the busy state — the turn is genuinely still running. Tell
          // the user it didn't take effect, so they don't pile a follow-up
          // onto a queue that won't drain until this turn finishes.
          store.setState({ error: i18n.t('session.errors.interruptNotReady') })
          return
        }
        abortActiveStream()
        store.setState({ isLoading: false, isBusy: false })
      } catch (err) {
        store.setState({
          error: err instanceof Error ? err.message : i18n.t('session.errors.interruptFailed'),
        })
      }
    },

    abortStream() {
      abortActiveStream()
      store.setState({ isLoading: false, isBusy: false })
    },

    async deleteSession() {
      abortActiveStream()
      store.setState({ isLoading: false, isDeleting: true, isBusy: true })
      try {
        const { activeSessionId } = store.getState()
        if (!activeSessionId) return
        await deps.api.deleteSession(workspaceId, activeSessionId)
        store.setState({ messages: [], error: null, loadedSessionId: undefined })
      } catch (err) {
        store.setState({
          error: err instanceof Error ? err.message : i18n.t('session.errors.deleteFailed'),
        })
      } finally {
        store.setState({ isDeleting: false, isBusy: false })
      }
    },

    reconnect() {
      startReconnect()
    },

    loadHistory(history, stats) {
      // Optimizer escape hatch: pre-fetched data assigned externally. We can't
      // know which session id this corresponds to, so keep loadedSessionId
      // unchanged — switchSession's no-op guard remains tied to whatever the
      // last "real" load set.
      store.setState({
        messages: history.map(toChatMessage),
        error: null,
        lastTurnStats: stats ?? null,
      })
    },

    clearMessages() {
      store.setState({
        messages: [],
        error: null,
        lastTurnStats: null,
        loadedSessionId: undefined,
      })
    },

    destroy() {
      abortActiveStream()
      toolDispatcher.destroy()
      store.setState({
        activeSessionId: undefined,
        loadedSessionId: undefined,
        messages: [],
        isLoading: false,
        isSwitching: false,
        isDeleting: false,
        error: null,
        pendingQuestion: null,
        lastTurnStats: null,
        isBusy: false,
        pendingMessage: null,
      })
    },
  }))

  return store
}
