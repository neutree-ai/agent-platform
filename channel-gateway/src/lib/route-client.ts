import { NapClient } from '../../../internal/client/src/index'
import * as db from '../services/db'

const NAP_API_URL = process.env.NAP_API_URL || 'http://localhost:3000'

/**
 * Build the platform client to act as when serving a route.
 *
 * Every call a connector makes targets `route.workspace_id`, so it has to run
 * as the route owner rather than the connector owner: a shared connector whose
 * route points at another user's workspace gets scoped out to a 404
 * "Workspace not found" otherwise. When the owners match — the common case —
 * the connector's own client is reused so the hot path costs no extra token
 * lookup.
 *
 * Returns null when the route owner has no platform token. That is logged
 * here; callers should bail quietly.
 */
export async function resolveRouteClient(
  label: string,
  route: { user_id: string },
  connector: { user_id: string },
  connectorClient: NapClient,
): Promise<NapClient | null> {
  if (route.user_id === connector.user_id) return connectorClient
  const routeToken = await db.getPlatformToken(route.user_id)
  if (!routeToken) {
    console.error(`${label}: no platform token for route owner=${route.user_id}`)
    return null
  }
  return new NapClient({ baseUrl: NAP_API_URL, serviceToken: routeToken })
}
