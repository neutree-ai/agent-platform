import { sessionKeys } from '@/hooks/useSessions'
import { api } from '@/lib/api/client'
import type { Session, Workspace } from '@/lib/api/types'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useWorkspaces } from './useWorkspaces'

type UnreadScope =
  | { kind: 'others'; currentWorkspaceId?: string }
  | { kind: 'ws'; workspaceId: string }

interface UnreadCount {
  /** Sessions waiting on the user — drives warning tone. */
  human: number
  /** Sessions with the agent currently running — counted, but informational. */
  agent: number
  /** human + agent — the number rendered. */
  total: number
}

/**
 * Single source of truth for activity counts. Reads from `useWorkspaces()` →
 * `ws.active_human_sessions` and `ws.active_agent_sessions` (server-precounted).
 *
 * - `{ kind: 'others' }` — sum across workspaces, optionally excluding one
 *   (used by the global Bell in fleet view: count everything; in ws view:
 *   count only "others" so the user isn't notified about the ws they're in).
 * - `{ kind: 'ws', workspaceId }` — per-workspace count (used by the
 *   WsSwitcher row badge and the Sessions panel "N unread" header).
 *
 * Consumers pick which field to render. The Bell shows `total` and chooses
 * its tone from `human > 0`; the Sessions panel header (which is wired to
 * "mark all read") still reads `human` only since marking only affects
 * human turns.
 */
export function useUnreadCount(scope: UnreadScope): UnreadCount {
  const { data: workspaces } = useWorkspaces()
  return useMemo(() => {
    const empty: UnreadCount = { human: 0, agent: 0, total: 0 }
    if (!workspaces) return empty
    if (scope.kind === 'ws') {
      const ws = workspaces.find((w) => w.id === scope.workspaceId)
      const human = ws?.active_human_sessions ?? 0
      const agent = ws?.active_agent_sessions ?? 0
      return { human, agent, total: human + agent }
    }
    let human = 0
    let agent = 0
    for (const ws of workspaces) {
      if (scope.currentWorkspaceId && ws.id === scope.currentWorkspaceId) continue
      human += ws.active_human_sessions ?? 0
      agent += ws.active_agent_sessions ?? 0
    }
    return { human, agent, total: human + agent }
  }, [workspaces, scope])
}

/**
 * Single write path for marking sessions seen. Optimistically zeroes out
 * the affected ws's `active_human_sessions` (and drops human entries from
 * `active_sessions`) so both the Bell and the panel header drop instantly,
 * then invalidates session list + workspaces caches for reconciliation.
 */
export function useMarkSeen() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, sessionId }: { workspaceId: string; sessionId?: string }) => {
      await api.markSessionsSeen(workspaceId, sessionId)
      return { workspaceId, sessionId }
    },
    onMutate: ({ workspaceId, sessionId }) => {
      // Optimistic update: walk every ['workspaces', ...] cache entry.
      const queries = qc.getQueriesData<Workspace[]>({ queryKey: ['workspaces'] })
      for (const [key, list] of queries) {
        if (!list) continue
        qc.setQueryData<Workspace[]>(key, (prev) =>
          prev?.map((ws) => {
            if (ws.id !== workspaceId) return ws
            if (sessionId) {
              const target = ws.active_sessions?.find((s) => s.id === sessionId)
              if (!target || target.chat_status !== 'human') return ws
              return {
                ...ws,
                active_human_sessions: Math.max(0, (ws.active_human_sessions ?? 0) - 1),
                active_sessions: ws.active_sessions.map((s) =>
                  s.id === sessionId ? { ...s, chat_status: 'idle' } : s,
                ),
              }
            }
            return {
              ...ws,
              active_human_sessions: 0,
              active_sessions: ws.active_sessions?.map((s) =>
                s.chat_status === 'human' ? { ...s, chat_status: 'idle' } : s,
              ),
            }
          }),
        )
      }

      // Also flip chat_status in the per-workspace sessions list cache so the
      // Sessions panel rows drop their "needs-you" dot instantly. Without this,
      // rows wait for the onSettled invalidate→refetch round-trip and look
      // intermittently stale (race with new agent turns landing meanwhile).
      type SessionsPage = { items: Session[]; total: number }
      type SessionsCache = { pages: SessionsPage[]; pageParams: unknown[] }
      const sessionCaches = qc.getQueriesData<SessionsCache>({
        queryKey: sessionKeys.list(workspaceId),
      })
      for (const [key, data] of sessionCaches) {
        if (!data) continue
        qc.setQueryData<SessionsCache>(key, {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            items: page.items.map((s) => {
              if (sessionId) {
                if (s.id !== sessionId || s.chat_status !== 'human') return s
              } else if (s.chat_status !== 'human') {
                return s
              }
              return { ...s, chat_status: 'idle' }
            }),
          })),
        })
      }
    },
    onSettled: (_data, _err, { workspaceId }) => {
      qc.invalidateQueries({ queryKey: sessionKeys.list(workspaceId) })
      qc.invalidateQueries({ queryKey: ['workspaces'] })
    },
  })
}
