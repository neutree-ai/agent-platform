import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { httpProxy } from '../lib/proxy'
import { COOKIE_NAME, verifySessionToken } from '../lib/session'
import { verifyServiceToken } from '../lib/token'
import * as sandbox from '../services/sandbox'

const cdp = new Hono()

async function authenticate(c: any): Promise<{ sub: string } | null> {
  // Bearer token (service token)
  const authHeader = c.req.header('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    return verifyServiceToken(authHeader.slice(7))
  }

  // Query param for WebSocket clients that can't set headers
  const url = new URL(c.req.url)
  const token = url.searchParams.get('token')
  if (token) return verifyServiceToken(token)

  // Cookie (browser UI)
  const cookie = getCookie(c, COOKIE_NAME)
  if (cookie) return verifySessionToken(cookie)

  return null
}

async function getEndpointWithAuth(c: any, port: number) {
  const user = await authenticate(c)
  if (!user) return { error: 'Unauthorized', status: 401 }

  const sandboxId = c.req.param('id')
  let sbx: Awaited<ReturnType<typeof sandbox.getBrowser>>
  try {
    sbx = await sandbox.getBrowser(sandboxId)
  } catch {
    return { error: 'Browser not found', status: 404 }
  }

  if (sbx.metadata?.['browser.user_id'] !== user.sub) {
    return { error: 'Not found', status: 404 }
  }

  try {
    const ep = await sandbox.getEndpoint(sandboxId, port)
    return { endpoint: ep.endpoint }
  } catch {
    return { error: 'Endpoint not available', status: 502 }
  }
}

// Rewrite webSocketDebuggerUrl in CDP JSON responses
function rewriteCdpJson(
  body: string,
  sandboxId: string,
  host: string,
  secure: boolean,
  token?: string,
): string {
  const base = `${secure ? 'wss' : 'ws'}://${host}/cdp/${sandboxId}/devtools/`
  const rewritten = body.replace(/wss?:\/\/[^/]+\/devtools\//g, base)
  // Append token to webSocketDebuggerUrl so clients like agent-browser auto-authenticate
  if (token) {
    return rewritten.replace(
      /"webSocketDebuggerUrl":"([^"]+)"/g,
      (_, url) => `"webSocketDebuggerUrl":"${url}?token=${token}"`,
    )
  }
  return rewritten
}

async function cdpProxyWithRewrite(c: any, ep: string, sandboxId: string): Promise<Response> {
  const url = new URL(c.req.url)
  const subpath = url.pathname.replace(`/cdp/${sandboxId}`, '') || '/'
  const isJsonEndpoint = subpath.startsWith('/json')

  const res = await httpProxy(c, ep, '/cdp')

  if (isJsonEndpoint && res.headers.get('content-type')?.includes('json')) {
    const body = await res.text()
    const host = new URL(c.req.url).host
    // Extract token from request to embed in webSocketDebuggerUrl
    const authHeader = c.req.header('authorization')
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : url.searchParams.get('token') || undefined
    const secure = url.protocol === 'https:'
    const rewritten = rewriteCdpJson(body, sandboxId, host, secure, token)
    // rewriteCdpJson changes body length (ws://127.0.0.1 → wss://<host>/cdp/<id>?token=…),
    // so the upstream Content-Length is stale. Drop it and let undici/hono
    // emit chunked — otherwise downstream fetch() hangs reading until deadline.
    const headers = new Headers(res.headers)
    headers.delete('content-length')
    return new Response(rewritten, {
      status: res.status,
      headers,
    })
  }

  return res
}

cdp.all('/:id/*', async (c) => {
  // WebSocket upgrades for /cdp/:id/devtools/* are intercepted at the raw HTTP
  // server layer in src/index.ts; this hono handler only sees plain HTTP.
  const result = await getEndpointWithAuth(c, 9222)
  if ('error' in result) return c.json({ error: result.error }, result.status as any)
  return cdpProxyWithRewrite(c, result.endpoint, c.req.param('id'))
})

cdp.all('/:id', async (c) => {
  const result = await getEndpointWithAuth(c, 9222)
  if ('error' in result) return c.json({ error: result.error }, result.status as any)
  return cdpProxyWithRewrite(c, result.endpoint, c.req.param('id'))
})

export default cdp
