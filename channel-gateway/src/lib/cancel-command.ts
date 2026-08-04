import type { NapClient } from '../../../internal/client/src/index'
import * as db from '../services/db'
import { resolveRouteClient } from './route-client'

/**
 * Interrupt the turn running in a chat thread, for the `/cancel` command.
 *
 * Connectors intercept `/cancel` before the job queue on purpose: inbound
 * messages are serialized behind the running turn, so a queued interrupt would
 * only arrive after the thing it meant to stop had finished. Going straight to
 * cp reaches the turn that is actually in flight. The user's follow-up then
 * resumes the same session with its history — cancel exists so a wrong host or
 * a missing detail can be corrected without starting over, and whatever the
 * interrupted turn had produced is discarded, which is the point.
 *
 * Returns the text to acknowledge with — each connector delivers it its own
 * way — or null when the route owner has no platform token, in which case the
 * caller should bail quietly (already logged).
 */
export async function cancelThreadTurn(
  label: string,
  route: db.Route,
  connector: db.Connector,
  connectorClient: NapClient,
  threadId: string,
): Promise<string | null> {
  const sessionTtlHours =
    ((route.config as Record<string, unknown>)?.session_ttl_hours as number) ?? 24
  const sessionId = await db.getThreadSessionId(route.id, threadId, sessionTtlHours)
  if (!sessionId) {
    console.log(`${label}: /cancel thread=${threadId} session=none`)
    return 'No active session.'
  }

  const client = await resolveRouteClient(label, route, connector, connectorClient)
  if (!client) return null

  try {
    // Interrupt the session, not the workspace: one workspace can back several
    // routes and threads at once, and `workspaces.interrupt` would stop other
    // people's turns along with this one.
    await client.sessions.interrupt(route.workspace_id, sessionId)
    console.log(`${label}: /cancel thread=${threadId} session=${sessionId}`)
    return 'Cancelled. Send your correction and I will continue from here.'
  } catch (e) {
    // A turn that already finished is the common case, not a failure — the
    // user pressed cancel a moment too late. Say so plainly instead of
    // surfacing an API error.
    console.warn(`${label}: /cancel failed session=${sessionId}:`, e)
    return 'Nothing to cancel — the current turn already finished.'
  }
}
