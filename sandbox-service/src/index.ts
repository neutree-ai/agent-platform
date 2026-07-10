import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { OpenAPIHono } from '@hono/zod-openapi'
import { Scalar } from '@scalar/hono-api-reference'
import { getCookie } from 'hono/cookie'
import { logger } from 'hono/logger'
import { WebSocket, WebSocketServer } from 'ws'
import { resolveUser } from './lib/auth'
import { initDb } from './lib/db'
import * as sandbox from './lib/sandbox'
import { COOKIE_NAME, verifySessionToken } from './lib/session'
import authRoutes from './routes/auth'
import sandboxRoutes from './routes/sandboxes'
import { handleSubdomainPreview, parseSubdomain } from './routes/subdomain-preview'

process.on('uncaughtException', (err) => {
  console.error('[fatal] Uncaught exception:', err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[fatal] Unhandled rejection:', reason)
})

const SANDBOX_DOMAIN = process.env.SANDBOX_DOMAIN || 'localhost'

const app = new OpenAPIHono()

// Register Bearer auth scheme referenced by `security: [{ bearerAuth: [] }]` in route defs.
app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  description: 'NAP OAuth access token or service token',
})

// Subdomain preview: {id}-{port}.<SANDBOX_DOMAIN> → proxy to sandbox
// Must be first middleware — intercepts before any other routing
app.use('*', async (c, next) => {
  const host = c.req.header('host')?.split(':')[0] ?? ''
  if (host !== SANDBOX_DOMAIN && host.endsWith(`.${SANDBOX_DOMAIN}`)) {
    return handleSubdomainPreview(c, host, SANDBOX_DOMAIN)
  }
  return next()
})

// Logging (skip health checks and preview proxy)
app.use('*', async (c, next) => {
  if (c.req.path === '/health') return next()
  const log = logger()
  return log(c, next)
})

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }))

// Public config endpoint (no auth required, consumed by frontend)
app.get('/api/config', (c) =>
  c.json({
    napUrl: process.env.NAP_OAUTH_URL || process.env.SANDBOX_SERVICE_URL || '',
    sandboxDomain: SANDBOX_DOMAIN,
  }),
)

// Auth middleware for /api/* (session cookie for UI)
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

  // 1. Bearer token (service token or OAuth access token)
  const user = await resolveUser(c)
  if (user) {
    c.set('user' as never, user as never)
    return next()
  }

  // 2. Session cookie (browser UI)
  const cookie = getCookie(c, COOKIE_NAME)
  if (cookie) {
    const payload = await verifySessionToken(cookie)
    if (payload) {
      c.set('user' as never, payload as never)
      return next()
    }
  }

  return c.json({ error: 'Unauthorized' }, 401)
})

// API routes (all under /api/*)
const api = new OpenAPIHono()
api.route('/auth', authRoutes)
api.route('/sandboxes', sandboxRoutes)
app.route('/api', api)

// OpenAPI spec + Scalar docs
app.doc31('/api/docs/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'NAP Sandbox Service',
    version: '0.1.0',
    description:
      'Owner-scoped lifecycle + exec API for ephemeral sandboxes (OpenSandbox SDK). Auth: Bearer token (NAP OAuth or service token) — UI also supports session cookie.',
  },
  servers: [{ url: '/' }],
  tags: [
    { name: 'sandboxes', description: 'Sandbox CRUD + exec + files + endpoint' },
    { name: 'auth', description: 'Session + OAuth' },
  ],
})

app.get(
  '/api/docs',
  Scalar({
    url: '/api/docs/openapi.json',
    pageTitle: 'NAP Sandbox Service API',
    hideClientButton: true,
  } as any),
)

// Static file serving for frontend
app.use('/assets/*', serveStatic({ root: './web/dist' }))
app.use('/favicon.svg', serveStatic({ root: './web/dist', path: '/favicon.svg' }))

// SPA fallback (skip API and proxy routes)
app.get('*', ((c: any) => {
  const path = c.req.path
  if (path.startsWith('/api/') || path === '/health') {
    return c.notFound()
  }
  return serveStatic({ root: './web/dist', path: 'index.html' })(c, async () => {})
}) as any)

const port = Number.parseInt(process.env.PORT || '3006')

await initDb()

const httpServer = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Sandbox service started on port ${info.port}`)
})

// WebSocket upgrade for subdomain preview. Bypasses hono entirely — the
// upgrade decision and proxy wiring live here so we can `handleUpgrade` against
// the raw socket. HTTP requests on the same subdomain still flow through
// `handleSubdomainPreview` via the hono middleware above.
const wss = new WebSocketServer({ noServer: true })

httpServer.on('upgrade', async (req, socket, head) => {
  const host = req.headers.host?.split(':')[0] ?? ''
  if (host === SANDBOX_DOMAIN || !host.endsWith(`.${SANDBOX_DOMAIN}`)) {
    socket.destroy()
    return
  }

  const parsed = parseSubdomain(host, SANDBOX_DOMAIN)
  if (!parsed) {
    socket.destroy()
    return
  }

  let endpointUrl: string
  try {
    // Direct pod address (not the opensandbox-server proxy) — the proxy path
    // doesn't carry WS upgrades cleanly and strips Authorization. See
    // getEndpointDirect.
    endpointUrl = await sandbox.getEndpointDirect(parsed.sandboxId, parsed.port)
  } catch {
    socket.destroy()
    return
  }

  const subpath = req.url || '/'
  const targetUrl = `ws://${endpointUrl.replace(/^https?:\/\//, '')}${subpath}`

  wss.handleUpgrade(req, socket, head, (ws) => {
    console.log(`[preview-ws] connecting to ${targetUrl}`)
    const upstream = new WebSocket(targetUrl)
    upstream.on('open', () => {
      console.log('[preview-ws] upstream connected')
    })
    upstream.on('message', (data) => {
      ws.send(data)
    })
    upstream.on('close', () => {
      ws.close()
    })
    upstream.on('error', (err) => {
      console.error('[preview-ws] upstream error:', err)
      ws.close()
    })
    ws.on('message', (data) => {
      if (upstream.readyState === WebSocket.OPEN) upstream.send(data)
    })
    ws.on('close', () => {
      upstream.close()
    })
  })
})
