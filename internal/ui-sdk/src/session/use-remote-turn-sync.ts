import { useEffect, useRef } from 'react'

/** How often a session is checked for turns started elsewhere. */
export const REMOTE_TURN_POLL_MS = 5000

export interface RemoteTurnSyncOptions {
  /**
   * Whether to check: while the session waits on other agents (their results
   * are posted to it as turns the platform starts), or when other people
   * write in it.
   */
  enabled: boolean
  /** The store's `syncRemoteTurn`. */
  syncRemoteTurn: () => Promise<void>
  /** Also called at each check, e.g. to re-read how many calls are still open. */
  onTick?: () => void
}

/**
 * Turns this page did not start don't reach its stream: other people's in a
 * shared workspace, and the ones the platform starts to deliver the results of
 * agent calls. Checks the active session for them every few seconds while the
 * page is visible.
 */
export function useRemoteTurnSync({ enabled, syncRemoteTurn, onTick }: RemoteTurnSyncOptions) {
  // The latest callbacks, so a new render does not restart the timer.
  const latest = useRef({ syncRemoteTurn, onTick })
  latest.current = { syncRemoteTurn, onTick }

  useEffect(() => {
    if (!enabled) return
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      void latest.current.syncRemoteTurn()
      latest.current.onTick?.()
    }, REMOTE_TURN_POLL_MS)
    return () => clearInterval(timer)
  }, [enabled])
}
