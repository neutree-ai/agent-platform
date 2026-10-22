import { api } from '@/lib/api/client'
import type { Session } from '@/lib/api/types'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * Determines which session to initially load.
 * Pure derivation — no store interaction.
 *
 * Priority:
 * 1. URL ?session= param (if valid)
 * 2. First session in the list (auto-select)
 * 3. undefined (new session mode)
 *
 * The session list is paginated, so a URL session missing from the loaded
 * pages is looked up by id before being treated as invalid.
 */
export function useAutoSelectSession(
  workspaceId: string | undefined,
  sessions: Session[],
  sessionsFetching: boolean,
): { initialSessionId: string | undefined; initialSession: Session | undefined } {
  const [searchParams] = useSearchParams()
  const urlSessionId = searchParams.get('session')

  const listedUrlSession = urlSessionId ? sessions.find((s) => s.id === urlSessionId) : undefined
  const { isError: urlSessionMissing } = useQuery({
    queryKey: ['session', workspaceId, urlSessionId],
    queryFn: () => api.getSession(workspaceId!, urlSessionId!),
    enabled: !!workspaceId && !!urlSessionId && !sessionsFetching && !listedUrlSession,
    retry: false,
  })

  return useMemo(() => {
    // While fetching, trust the URL param if present
    if (sessionsFetching) {
      return { initialSessionId: urlSessionId ?? undefined, initialSession: undefined }
    }

    if (listedUrlSession) {
      return { initialSessionId: listedUrlSession.id, initialSession: listedUrlSession }
    }

    // URL session beyond the loaded pages: keep it while the lookup is
    // pending or once it resolves; fall through only if it doesn't exist.
    if (urlSessionId && !urlSessionMissing) {
      return { initialSessionId: urlSessionId, initialSession: undefined }
    }

    // Auto-select first session
    if (sessions.length > 0) {
      return { initialSessionId: sessions[0].id, initialSession: sessions[0] }
    }

    return { initialSessionId: undefined, initialSession: undefined }
  }, [urlSessionId, listedUrlSession, urlSessionMissing, sessions, sessionsFetching])
}
