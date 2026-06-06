import { create } from 'zustand'

/**
 * Lightweight global store that holds "which session is active".
 *
 * AgentSessionStore (per-workspace, context-scoped) owns the heavy state —
 * messages, SSE streams, loading flags, etc. But it lives inside
 * AgentSessionProvider, so components outside the provider (e.g. AppSidebar)
 * cannot call its `switchSession()` directly.
 *
 * This store bridges the gap:
 *   Sidebar  →  switchTo()  →  active-session-store
 *   Provider subscribes  →  calls AgentSessionStore.switchSession()
 *   AgentSessionStore updates  →  Provider syncs back via switchTo()
 *
 * URL ?session= is a derived effect synced by the provider, not a source of truth.
 *
 * Always write workspaceId alongside sessionId — readers (e.g. the sessions
 * list highlight) scope by workspace, so a half-updated `{ sessionId }` with
 * a stale workspaceId silently fails to match.
 */

interface ActiveSessionState {
  workspaceId: string | undefined
  sessionId: string | undefined
  context?: { sessionChatStatus?: string; lastTurnStats?: any }
}

interface ActiveSessionStore extends ActiveSessionState {
  /** Request a session switch. Called by sidebar or other outside-provider code. */
  switchTo(
    workspaceId: string,
    sessionId: string | undefined,
    context?: ActiveSessionState['context'],
  ): void
}

export const useActiveSession = create<ActiveSessionStore>()((set) => ({
  workspaceId: undefined,
  sessionId: undefined,
  context: undefined,

  switchTo: (workspaceId, sessionId, context) => set({ workspaceId, sessionId, context }),
}))
