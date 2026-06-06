import type { Session } from '@/lib/api/types'
import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * Determines which session to initially load.
 * Pure derivation — no side effects, no store interaction.
 *
 * Priority:
 * 1. URL ?session= param (if valid)
 * 2. First session in the list (auto-select)
 * 3. undefined (new session mode)
 */
export function useAutoSelectSession(
  sessions: Session[],
  sessionsFetching: boolean,
): { initialSessionId: string | undefined; initialSession: Session | undefined } {
  const [searchParams] = useSearchParams()
  const urlSessionId = searchParams.get('session')

  return useMemo(() => {
    // While fetching, trust the URL param if present
    if (sessionsFetching) {
      return { initialSessionId: urlSessionId ?? undefined, initialSession: undefined }
    }

    // URL param points to a valid session
    if (urlSessionId) {
      const session = sessions.find((s) => s.id === urlSessionId)
      if (session) return { initialSessionId: session.id, initialSession: session }
    }

    // Auto-select first session
    if (sessions.length > 0) {
      return { initialSessionId: sessions[0].id, initialSession: sessions[0] }
    }

    return { initialSessionId: undefined, initialSession: undefined }
  }, [urlSessionId, sessions, sessionsFetching])
}
