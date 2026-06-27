import type { Duplex } from 'node:stream'
import type { Mux } from '../../../../internal/env-tunnel'

// In-cp registry of live tunnel sessions, keyed by environment. The gateway WS
// route registers a session when a runner connects; cp's data-plane routing
// (C3) looks one up to reach a workspace in that remote environment. One active
// session per environment for v1 (single runner) — a new connection supersedes
// a stale one. Lives in cp memory; fine while cp is replicas:1 (if cp goes
// multi-replica, this becomes a sticky-routing / shared-registry concern).

interface GatewaySession {
  environmentId: string
  mux: Mux
}

const sessions = new Map<string, GatewaySession>()

export function registerSession(session: GatewaySession): void {
  const prev = sessions.get(session.environmentId)
  sessions.set(session.environmentId, session)
  // Supersede a stale session only after the new one is in place, so the old
  // session's close handler (removeSession) won't evict the new entry.
  if (prev && prev.mux !== session.mux) prev.mux.close()
}

export function removeSession(environmentId: string, mux: Mux): void {
  if (sessions.get(environmentId)?.mux === mux) sessions.delete(environmentId)
}

/**
 * Open a forward (cp→agent) data-plane stream to a workspace in a remote
 * environment. `meta` is the opaque target the runner resolves (e.g.
 * "fwd:<wsId>:3001"). Returns null if the environment has no live runner.
 */
export function openForwardStream(environmentId: string, meta: string): Duplex | null {
  const session = sessions.get(environmentId)
  return session ? session.mux.openStream(meta) : null
}
