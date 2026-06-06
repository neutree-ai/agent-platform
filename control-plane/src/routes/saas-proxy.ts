import { Hono } from 'hono'
import type { AppEnv } from '../lib/types'
import { getMcpCatalogEntry } from '../services/db/mcp-catalog'
import {
  McpOAuthReauthRequired,
  getValidAccessToken,
  serverOriginFromUrl,
} from '../services/mcp-oauth'

// Service base URLs come from mcp_catalog.saas_url. The URL path segment IS
// the catalog id verbatim. The base URL is appended unchanged — services
// that mount their REST API under a sub-path encode that sub-path directly
// in saas_url (e.g. `https://example.com/api`).
async function getServiceBaseUrl(service: string): Promise<string | null> {
  const entry = await getMcpCatalogEntry(service)
  if (entry?.saas_url) return entry.saas_url.replace(/\/$/, '')
  return null
}

const saasProxy = new Hono<AppEnv>()

saasProxy.all('/:service/*', async (c) => {
  const service = c.req.param('service')
  const baseUrl = await getServiceBaseUrl(service)
  if (!baseUrl) {
    return c.json({ error: `Unknown service: ${service}` }, 404)
  }

  // Extract the path after /_saas/:service/
  const fullPath = c.req.path
  const prefix = `/_saas/${service}/`
  const subPath = fullPath.slice(fullPath.indexOf(prefix) + prefix.length)
  const url = new URL(c.req.url)
  const targetUrl = `${baseUrl}/${subPath}${url.search}`

  // Pass through client headers
  const headers = new Headers()
  for (const key of ['Content-Type', 'Accept', 'X-Workspace-ID']) {
    const val = c.req.header(key)
    if (val) headers.set(key, val)
  }

  // Authorization: per-user OAuth token from mcp_oauth_tokens. Services that
  // don't require OAuth (cluster-internal, header-trusted) simply ignore the
  // missing Authorization header.
  const userId = c.get('user')?.sub
  const serverOrigin = serverOriginFromUrl(baseUrl)
  let oauthToken: string | null = null
  let needsReauth: McpOAuthReauthRequired | null = null
  if (userId) {
    try {
      oauthToken = await getValidAccessToken(userId, serverOrigin)
    } catch (e) {
      if (e instanceof McpOAuthReauthRequired) {
        needsReauth = e
      } else {
        throw e
      }
    }
  }
  if (oauthToken) {
    headers.set('Authorization', `Bearer ${oauthToken}`)
  }

  // If the user's OAuth token is dead and we have no other auth source, fail
  // fast with a structured error so the UI can prompt re-auth instead of
  // letting the upstream return a generic 401.
  if (needsReauth && !headers.has('Authorization')) {
    return c.json(
      {
        error: 'needs_reauth',
        server_origin: needsReauth.serverOrigin,
        oauth_error: needsReauth.oauthError,
        message: `OAuth token for ${needsReauth.serverOrigin} is no longer valid; please reconnect this service.`,
      },
      401,
      {
        'WWW-Authenticate': `Bearer realm="saas", error="invalid_token", error_description="reauth required"`,
      },
    )
  }

  let body: ArrayBuffer | undefined
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    body = await c.req.arrayBuffer()
  }

  const resp = await fetch(targetUrl, {
    method: c.req.method,
    headers,
    body,
  })

  return new Response(resp.body, {
    status: resp.status,
    headers: { 'Content-Type': resp.headers.get('Content-Type') || 'application/json' },
  })
})

export default saasProxy
