import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { OpenAPIHono } from '@hono/zod-openapi'
import { Scalar } from '@scalar/hono-api-reference'
import { getCookie } from 'hono/cookie'
import { logger } from 'hono/logger'
import { WebSocket, WebSocketServer } from 'ws'
import { initDb } from './lib/db'
import { COOKIE_NAME, verifySessionToken } from './lib/session'
import { verifyServiceToken } from './lib/token'
import authRoutes from './routes/auth'
import browserRoutes from './routes/browsers'
import cdpRoutes from './routes/cdp'
import liveRoutes from './routes/live'
import recRoutes from './routes/rec'
import * as pool from './services/pool'
import * as sandbox from './services/sandbox'

process.on('uncaughtException', (err) => {
  console.error('[fatal] Uncaught exception:', err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[fatal] Unhandled rejection:', reason)
})

const app = new OpenAPIHono()

// Register Bearer auth scheme referenced by `security: [{ bearerAuth: [] }]`.
app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  description: 'NAP OAuth access token or service token',
})

// Logging (skip health checks and live proxy)
app.use('*', async (c, next) => {
  if (
    c.req.path === '/health' ||
    c.req.path.startsWith('/live/') ||
    c.req.path.startsWith('/cdp/') ||
    c.req.path.startsWith('/rec/')
  )
    return next()
  const log = logger()
  return log(c, next)
})

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }))

// Auth middleware for /api/*
app.use('/api/*', async (c, next) => {
  const path = c.req.path

  if (
    path === '/api/auth/login' ||
    path === '/api/auth/callback' ||
    path === '/api/auth/logout' ||
    path === '/api/docs' ||
    path === '/api/docs/openapi.json'
  ) {
    return next()
  }

  // 1. Bearer service token (from control-plane / MCP)
  const authHeader = c.req.header('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const user = await verifyServiceToken(authHeader.slice(7))
    if (user) {
      c.set('user' as never, user as never)
      return next()
    }
    return c.json({ error: 'Unauthorized' }, 401)
  }

  // 2. ?token= query param — for shareable URLs (e.g. file downloads embedded
  //    in chat). Mirrors the same fallback that /cdp and /live already accept.
  const queryToken = new URL(c.req.url).searchParams.get('token')
  if (queryToken) {
    const user = await verifyServiceToken(queryToken)
    if (user) {
      c.set('user' as never, user as never)
      return next()
    }
    return c.json({ error: 'Unauthorized' }, 401)
  }

  // 3. Session cookie (browser UI)
  const token = getCookie(c, COOKIE_NAME)
  if (!token) return c.json({ error: 'Unauthorized' }, 401)

  const payload = await verifySessionToken(token)
  if (!payload) return c.json({ error: 'Unauthorized' }, 401)

  c.set('user' as never, payload as never)
  return next()
})

// Public config endpoint (no auth required, consumed by frontend)
app.get('/api/config', (c) =>
  c.json({
    napUrl: process.env.NAP_OAUTH_URL || process.env.BROWSER_SERVICE_URL || '',
  }),
)

// API routes
const api = new OpenAPIHono()
api.route('/auth', authRoutes)
api.route('/browsers', browserRoutes)
app.route('/api', api)

// OpenAPI spec + Scalar docs
app.doc31('/api/docs/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'NAP Browser Service',
    version: '0.1.0',
    description:
      'Owner-scoped lifecycle API for ephemeral browser instances. Exposes CDP and live-view endpoints per browser. Auth: Bearer token (NAP OAuth or service token) — UI also supports session cookie.',
  },
  servers: [{ url: '/' }],
  tags: [
    { name: 'browsers', description: 'Browser lifecycle' },
    { name: 'auth', description: 'Session + OAuth' },
  ],
})

app.get(
  '/api/docs',
  Scalar({
    url: '/api/docs/openapi.json',
    pageTitle: 'NAP Browser Service API',
    hideClientButton: true,
  } as any),
)

// Proxy routes (auth handled inside each)
app.route('/live', liveRoutes)
app.route('/cdp', cdpRoutes)
app.route('/rec', recRoutes)

// Static file serving for frontend
app.use('/assets/*', serveStatic({ root: './web/dist' }))
app.use('/favicon.svg', serveStatic({ root: './web/dist', path: '/favicon.svg' }))

// SPA fallback
app.get('*', serveStatic({ root: './web/dist', path: 'index.html' }))

const port = Number.parseInt(process.env.PORT || '3005')

// Claims are persisted in Postgres so a restart can keep already-claimed warm
// instances alive instead of reaping them (see services/pool.ts). Skip when the
// pool is disabled — no claims to persist, no DB needed.
if (pool.isPoolEnabled()) {
  await initDb()
}

const httpServer = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Browser service started on port ${info.port}`)
  // Warm pool: no-op unless BROWSER_WARM_POOL_SIZE > 0.
  pool.startPool().catch((e) => console.error('[pool] startup failed', e))
})

// ─── WebSocket upgrade dispatch ─────────────────────────────────────────────
//
// Bypasses hono so we can call `wss.handleUpgrade()` against the raw socket.
// The hono /cdp and /live handlers only see plain HTTP requests.
//
// Routes:
//   /cdp/:id/devtools/* — port 9222, auth via Bearer / ?token= / cookie
//   /live/t/:token/:id/* — port 8080, auth via :token URL segment
//   /live/:id/* — port 8080, auth via cookie / Bearer / ?token=

const wss = new WebSocketServer({ noServer: true })

const CDP_RE = /^\/cdp\/([^/]+)/
const LIVE_TOKEN_RE = /^\/live\/t\/([^/]+)\/([^/]+)/
const LIVE_RE = /^\/live\/([^/]+)/

function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined
  for (const pair of header.split(';')) {
    const [k, ...v] = pair.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return undefined
}

async function authenticateUpgrade(
  req: { headers: Record<string, string | string[] | undefined> },
  url: URL,
  strategy: 'cdp' | 'live-token' | 'live',
  pathToken?: string,
): Promise<{ sub: string } | null> {
  if (strategy === 'live-token') {
    return pathToken ? await verifyServiceToken(pathToken) : null
  }

  // Bearer header
  const authHeader = req.headers.authorization
  const headerStr = Array.isArray(authHeader) ? authHeader[0] : authHeader
  if (headerStr?.startsWith('Bearer ')) {
    const token = headerStr.slice(7)
    return strategy === 'cdp'
      ? await verifyServiceToken(token)
      : ((await verifySessionToken(token)) ?? (await verifyServiceToken(token)))
  }

  // Query ?token=
  const queryToken = url.searchParams.get('token')
  if (queryToken) return await verifyServiceToken(queryToken)

  // Cookie
  const cookieHeader = req.headers.cookie
  const cookieStr = Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader
  const sessionCookie = parseCookie(cookieStr, COOKIE_NAME)
  if (sessionCookie) return await verifySessionToken(sessionCookie)

  return null
}

httpServer.on('upgrade', async (req, socket, head) => {
  try {
    const path = (req.url ?? '/').split('?')[0]
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)

    let sandboxId: string
    let port: number
    let prefix: string
    let user: { sub: string } | null

    const liveTokenMatch = path.match(LIVE_TOKEN_RE)
    const cdpMatch = liveTokenMatch ? null : path.match(CDP_RE)
    const liveMatch = liveTokenMatch || cdpMatch ? null : path.match(LIVE_RE)
    if (liveTokenMatch) {
      sandboxId = liveTokenMatch[2]
      port = 8080
      prefix = `/live/t/${liveTokenMatch[1]}`
      user = await authenticateUpgrade(req, url, 'live-token', liveTokenMatch[1])
    } else if (cdpMatch) {
      sandboxId = cdpMatch[1]
      port = 9222
      prefix = '/cdp'
      user = await authenticateUpgrade(req, url, 'cdp')
    } else if (liveMatch) {
      sandboxId = liveMatch[1]
      port = 8080
      prefix = '/live'
      user = await authenticateUpgrade(req, url, 'live')
    } else {
      socket.destroy()
      return
    }

    if (!user) {
      socket.destroy()
      return
    }

    let sbx: Awaited<ReturnType<typeof sandbox.getBrowser>>
    try {
      sbx = await sandbox.getBrowser(sandboxId)
    } catch {
      socket.destroy()
      return
    }
    if (!pool.isOwnedBy(sbx, user.sub)) {
      socket.destroy()
      return
    }

    let endpoint: string
    try {
      const ep = await sandbox.getEndpoint(sandboxId, port)
      endpoint = ep.endpoint
    } catch {
      socket.destroy()
      return
    }

    const subpath = (path.replace(`${prefix}/${sandboxId}`, '') || '/') + url.search
    const targetUrl = `ws://${endpoint}${subpath}`

    wss.handleUpgrade(req, socket, head, (ws) => {
      proxyWebSocket(ws, targetUrl)
    })
  } catch (err) {
    console.error('[ws-proxy] upgrade error:', err)
    socket.destroy()
  }
})

function proxyWebSocket(client: WebSocket, targetUrl: string): void {
  const t0 = Date.now()
  console.log(`[ws-proxy] open client → upstream ${targetUrl}`)

  const upstream = new WebSocket(targetUrl)
  // Preserve the frame opcode (text vs binary) across the proxy. `ws`'s
  // send(buffer) defaults to a binary frame, so without the {binary} option
  // every text frame from upstream (e.g. neko's JSON signaling) gets
  // re-emitted as binary, which the client tries to JSON.parse as a Blob and
  // silently fails — the WebRTC handshake then stalls and the client closes
  // the socket after a few seconds. (Bun's WebSocket preserved the opcode
  // automatically; this regressed in the Bun→Node migration.)
  const pending: Array<{ data: Buffer | ArrayBuffer | Buffer[]; isBinary: boolean }> = []

  upstream.on('open', () => {
    const dt = Date.now() - t0
    console.log(
      `[ws-proxy] upstream connected after ${dt}ms, flushing ${pending.length} queued message(s)`,
    )
    for (const m of pending) upstream.send(m.data, { binary: m.isBinary })
    pending.length = 0
  })
  upstream.on('message', (data, isBinary) => {
    client.send(data, { binary: isBinary })
  })
  upstream.on('close', () => {
    client.close()
  })
  upstream.on('error', (err) => {
    console.error('[ws-proxy] upstream error:', err)
    client.close()
  })
  client.on('message', (message, isBinary) => {
    const len = Array.isArray(message)
      ? message.reduce((n, b) => n + b.byteLength, 0)
      : (message as Buffer | ArrayBuffer).byteLength
    if (upstream.readyState === WebSocket.CONNECTING) {
      console.log(`[ws-proxy] queueing message (upstream still CONNECTING), len=${len}`)
      pending.push({ data: message, isBinary })
      return
    }
    if (upstream.readyState !== WebSocket.OPEN) {
      console.warn(`[ws-proxy] dropping message, upstream state=${upstream.readyState}`)
      return
    }
    upstream.send(message, { binary: isBinary })
  })
  client.on('close', () => {
    upstream.close()
  })
}
