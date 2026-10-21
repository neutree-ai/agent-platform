// Client authentication for the application protocol (/apps/v1/*).
//
// The caller is an application registered under /api/applications, proving
// itself with its client id and secret over HTTP Basic (RFC 6749 §2.3.1). It
// is not a user: routes behind this act on the users the application
// provisioned, and only on those.

import type { MiddlewareHandler } from 'hono'
import type { AppClientEnv } from '../lib/types'
import { getClient, verifyClientSecret } from '../services/oauth-provider'

function parseBasic(header: string | undefined): { id: string; secret: string } | null {
  if (!header?.startsWith('Basic ')) return null
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
  const sep = decoded.indexOf(':')
  if (sep <= 0) return null
  // Client ids are slugs and secrets hex, so the form-encoding RFC 6749 asks
  // for is the identity here and nothing needs decoding.
  return { id: decoded.slice(0, sep), secret: decoded.slice(sep + 1) }
}

export const appAuth: MiddlewareHandler<AppClientEnv> = async (c, next) => {
  const creds = parseBasic(c.req.header('Authorization'))
  if (!creds) {
    c.header('WWW-Authenticate', 'Basic realm="apps"')
    return c.json({ error: 'Unauthorized' }, 401)
  }
  const client = await getClient(creds.id)
  if (!client || !verifyClientSecret(client, creds.secret)) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  c.set('appPrincipal', { clientId: client.id })
  return next()
}
