import { getCookie } from 'hono/cookie'
import * as pool from '../services/pool'
import * as sandbox from '../services/sandbox'
import { COOKIE_NAME, type SessionPayload, verifySessionToken } from './session'
import { verifyServiceToken } from './token'

export async function getUser(c: any): Promise<SessionPayload | null> {
  // Cookie auth
  const token = getCookie(c, COOKIE_NAME)
  if (token) return verifySessionToken(token)

  // Bearer token auth (for CDP clients like Playwright)
  const authHeader = c.req.header('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    return verifySessionToken(authHeader.slice(7))
  }

  // Query param service token (for iframe embedding)
  const url = new URL(c.req.url)
  const qToken = url.searchParams.get('token')
  if (qToken) {
    const user = await verifyServiceToken(qToken)
    if (user) return user as SessionPayload
  }

  return null
}

export async function resolveEndpoint(
  c: any,
  user: SessionPayload,
  port: number,
): Promise<{ endpoint: string } | Response> {
  const sandboxId = c.req.param('id')

  let sbx: Awaited<ReturnType<typeof sandbox.getBrowser>>
  try {
    sbx = await sandbox.getBrowser(sandboxId)
  } catch {
    return c.json({ error: 'Browser not found' }, 404)
  }

  if (!pool.isOwnedBy(sbx, user.sub)) {
    return c.json({ error: 'Not found' }, 404)
  }

  try {
    return await sandbox.getEndpoint(sandboxId, port)
  } catch {
    return c.json({ error: 'Endpoint not available' }, 502)
  }
}

export async function httpProxy(c: any, endpoint: string, prefix: string): Promise<Response> {
  const sandboxId = c.req.param('id')
  const url = new URL(c.req.url)
  const subpath = (url.pathname.replace(`${prefix}/${sandboxId}`, '') || '/') + url.search
  const targetUrl = `http://${endpoint}${subpath}`

  try {
    const reqHeaders = new Headers(c.req.raw.headers)
    reqHeaders.delete('host')
    reqHeaders.set('host', endpoint)

    const hasBody = c.req.method !== 'GET' && c.req.method !== 'HEAD'
    const proxyRes = await fetch(targetUrl, {
      method: c.req.method,
      headers: reqHeaders,
      body: hasBody ? c.req.raw.body : undefined,
      // Node 18+ undici requires `duplex: 'half'` when body is a ReadableStream;
      // Bun tolerated its absence. Without this, every non-GET proxied request
      // throws `RequestInit: duplex option is required when sending a body`.
      ...(hasBody ? { duplex: 'half' as const } : {}),
      redirect: 'manual',
    })

    const resHeaders = new Headers(proxyRes.headers)
    resHeaders.delete('transfer-encoding')

    return new Response(proxyRes.body, {
      status: proxyRes.status,
      headers: resHeaders,
    })
  } catch (err) {
    console.error(`[proxy] ${prefix} error:`, err)
    return c.json({ error: 'Proxy failed' }, 502)
  }
}

// WebSocket upgrades are handled at the raw HTTP server layer in src/index.ts
// (httpServer.on('upgrade', ...)), not here. The hono routes for /cdp /live /rec
// only see plain HTTP traffic; upgrade requests bypass hono entirely.
