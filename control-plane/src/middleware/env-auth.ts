// BYOI P2 — env-token auth middleware for the runner protocol (design §3.2, §9).
//
// Guards /env/v1/*. Resolves a Bearer environment token to a RESTRICTED
// principal ({ environmentId }) — deliberately not a user. Route handlers read
// c.get('envPrincipal') and must force every query to that environment_id, so a
// runner can only ever touch its own environment's placements.

import type { MiddlewareHandler } from 'hono'
import type { EnvAppEnv } from '../lib/types'
import { verifyEnvironmentToken } from '../services/db/environment-tokens'

export const envAuth: MiddlewareHandler<EnvAppEnv> = async (c, next) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  const principal = await verifyEnvironmentToken(authHeader.slice(7))
  if (!principal) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  c.set('envPrincipal', principal)
  return next()
}
