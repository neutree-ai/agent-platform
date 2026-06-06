import { sessionKeys } from '@/hooks/useSessions'
import { api } from '@/lib/api/client'
import { createAgentChat, createCPReconnectStream } from '@/lib/api/sse'
import { i18n } from '@/lib/i18n'
import { playNotifySound } from '@/lib/sound'
import { useQueryClient } from '@tanstack/react-query'
import { type ReactNode, createContext, useContext, useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import type { StoreApi } from 'zustand/vanilla'
import { useActiveSession } from './active-session-store'
import {
  type AgentSessionDeps,
  type AgentSessionSlice,
  createAgentSessionStore,
} from './agent-session-store'

// ── Context ──

const AgentSessionCtx = createContext<StoreApi<AgentSessionSlice> | null>(null)

// ── Provider ──

interface AgentSessionProviderProps {
  workspaceId: string
  workspaceName: string
  /** The session to load on mount. Determined by caller (URL or auto-select). */
  initialSessionId: string | undefined
  /** Initial context for the session (chat_status, etc). */
  initialContext?: { sessionChatStatus?: string; lastTurnStats?: any }
  /** Fire-and-forget: sync store activeSessionId back to URL. */
  syncSessionToUrl: (sessionId: string | undefined) => void
  /**
   * Called once with the new session id when the agent reports `session.started`
   * for a fresh turn (i.e., the user just created a session). Embedders that
   * need to record the session — e.g., teamwork linking sessions to a task —
   * hook in here. Default: no-op.
   */
  onSessionCreated?: (sessionId: string) => void
  /**
   * Override the chat endpoint that the store POSTs new turns to. Teamwork
   * embeds use this to route through `/api/teamwork/:id/chat` so cp can
   * thread `X-Task-Id` into the sidecar — call_agent then sees the task
   * scope and can dispatch to roster members the global visibility rules
   * would normally reject. Defaults to the generic `/api/workspaces/:id/chat`.
   */
  chatEndpoint?: string
  children: ReactNode
}

export function AgentSessionProvider({
  workspaceId,
  workspaceName,
  initialSessionId,
  initialContext,
  syncSessionToUrl,
  onSessionCreated,
  chatEndpoint,
  children,
}: AgentSessionProviderProps) {
  const queryClient = useQueryClient()
  const workspaceNameRef = useRef(workspaceName)
  workspaceNameRef.current = workspaceName
  const syncRef = useRef(syncSessionToUrl)
  syncRef.current = syncSessionToUrl
  const onSessionCreatedRef = useRef(onSessionCreated)
  onSessionCreatedRef.current = onSessionCreated

  const [store] = useState(() => {
    const deps: AgentSessionDeps = {
      api: {
        getWorkspaceMessages: (wid, sid) => api.getWorkspaceMessages(wid, sid),
        getSession: (wid, sid) => api.getSession(wid, sid),
        setPendingMessage: async (wid, sid, msg) => {
          await api.setPendingMessage(wid, sid, msg)
        },
        clearPendingMessage: async (wid, sid) => {
          await api.clearPendingMessage(wid, sid)
        },
        getPendingQuestion: (wid, sid) => api.getPendingQuestion(wid, sid),
        respondToQuestion: async (wid, sid, rid, answers) => {
          await api.respondToQuestion(wid, sid, rid, answers)
        },
        interruptSession: (wid, sid) => api.interruptSession(wid, sid),
        deleteSession: async (wid, sid) => {
          await api.deleteSession(wid, sid)
        },
      },
      sse: { createAgentChat, createCPReconnectStream },
      effects: {
        onSessionCreated: (sid) => onSessionCreatedRef.current?.(sid),
        onTurnComplete: () => {
          playNotifySound()
        },
        invalidateSessions: (wid) =>
          queryClient.invalidateQueries({ queryKey: sessionKeys.list(wid) }),
        invalidateWorkspaces: () => queryClient.invalidateQueries({ queryKey: ['workspaces'] }),
      },
    }
    const s = createAgentSessionStore(workspaceId, deps, { chatEndpoint })
    // Set activeSessionId synchronously so the first render has the correct value.
    // The async history load happens in the mount effect below.
    if (initialSessionId) {
      s.setState({ activeSessionId: initialSessionId })
      useActiveSession.getState().switchTo(workspaceId, initialSessionId)
    }
    return s
  })

  // Load initial session — runs when initialSessionId first becomes available
  // (may be immediate if URL has ?session=, or delayed until sessions load for auto-select)
  const initialLoadedRef = useRef(false)
  useEffect(() => {
    if (initialLoadedRef.current) return
    if (!initialSessionId) return
    initialLoadedRef.current = true
    store.getState().switchSession(initialSessionId, initialContext)
  }, [store, initialSessionId, initialContext])

  // Sync active-session-store → internal store (sidebar writes here)
  useEffect(
    () =>
      useActiveSession.subscribe((curr, prev) => {
        if (curr.workspaceId !== workspaceId) return
        if (curr.sessionId === prev.sessionId && curr.workspaceId === prev.workspaceId) return
        if (curr.sessionId === store.getState().activeSessionId) return
        store.getState().switchSession(curr.sessionId, curr.context)
      }),
    [store, workspaceId],
  )

  // Sync internal store → active-session-store + URL.
  // Use switchTo (not setSessionId) so workspaceId is written alongside the
  // session id — readers like WorkspaceSessionsPanel scope the highlight to
  // the active workspace, and a stale/empty workspaceId silently swallows
  // the match.
  useEffect(
    () =>
      store.subscribe((state, prev) => {
        if (state.activeSessionId !== prev.activeSessionId) {
          syncRef.current(state.activeSessionId)
          useActiveSession.getState().switchTo(workspaceId, state.activeSessionId)
        }
      }),
    [store, workspaceId],
  )

  // beforeunload when busy
  const isBusy = useStore(store, (s) => s.isBusy)
  useEffect(() => {
    if (!isBusy) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isBusy])

  // Abort active SSE stream on unmount (store itself is GC'd with the component)
  useEffect(
    () => () => {
      store.getState().abortStream()
    },
    [store],
  )

  return <AgentSessionCtx.Provider value={store}>{children}</AgentSessionCtx.Provider>
}

// ── Hooks ──

function useStoreApi(): StoreApi<AgentSessionSlice> {
  const store = useContext(AgentSessionCtx)
  if (!store) throw new Error(i18n.t('common.errors.agentSessionProviderRequired'))
  return store
}

export function useAgentSessionStore<T>(selector: (state: AgentSessionSlice) => T): T {
  return useStore(useStoreApi(), selector)
}

export function useAgentSessionActions() {
  // Actions are stable references on the zustand store — read once, never changes.
  return useStoreApi().getState()
}

/**
 * True when rendered inside an `AgentSessionProvider`. Lets components that
 * normally drive the session (e.g. tool renderers with Approve/Reject) detect
 * a provider-less context — such as the public `SharePage` — and fall back to
 * a static, read-only rendering instead of throwing.
 */
export function useHasAgentSessionProvider(): boolean {
  return useContext(AgentSessionCtx) !== null
}
