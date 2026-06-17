import { readFile } from 'node:fs/promises'
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici'

setGlobalDispatcher(new EnvHttpProxyAgent())
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { createNodeWebSocket } from '@hono/node-ws'
import { OpenAPIHono } from '@hono/zod-openapi'
import { Scalar } from '@scalar/hono-api-reference'
import { compress } from 'hono/compress'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { logger } from 'hono/logger'
import { startJobQueue } from './lib/jobs'
import { startPprofServer } from './lib/pprof-server'
import { startReconcileLoop } from './lib/reconcile'
import { hashToken } from './lib/service-token'
import { initSkillReloadQueue } from './lib/skill-reload-queue'
import type { AppEnv } from './lib/types'
import { handleMcpRequest } from './mcp/server'
import adminRoutes from './routes/admin'
import applicationsRoutes from './routes/applications'
import asrRoutes from './routes/asr'
import authRoutes from './routes/auth'
import batchRunRoutes from './routes/batch-runs'
import cgProxy from './routes/cg-proxy'
import credentialsRoutes from './routes/credentials'
import internalRoutes from './routes/internal'
import invitesRoutes from './routes/invites'
import jobRoutes from './routes/jobs'
import mcpCatalogRoutes from './routes/mcp-catalog'
import mcpOAuthRoutes from './routes/mcp-oauth'
import mcpProxyRoutes from './routes/mcp-proxy'
import meActivityRoutes from './routes/me/activity'
import meProfileRoutes from './routes/me/profile'
import meRecentSessionsRoutes from './routes/me/recent-sessions'
import meUsageRoutes from './routes/me/usage'
import { memoryStoresRoutes, workspaceMemoryAttachmentRoutes } from './routes/memory-stores'
import notificationsRoutes from './routes/notifications'
import oauthProviderRoutes from './routes/oauth-provider'
import pluginsRoutes from './routes/plugins'
import promptsReadRoutes from './routes/prompts/read'
import promptsWriteRoutes from './routes/prompts/write'
import providersRoutes from './routes/providers'
import { createProxyRoutes } from './routes/proxy'
import { publicExportsApp } from './routes/public-exports'
import saasProxyRoutes from './routes/saas-proxy'
import serviceTokenRoutes from './routes/service-tokens'
import sharesRoutes from './routes/shares'
import skillsRoutes from './routes/skills'
import systemWorkspacesRoutes from './routes/system-workspaces'
import tagsRoutes from './routes/tags'
import teamsRoutes from './routes/teams'
import teamworkRoutes from './routes/teamwork'
import templatesRoutes from './routes/templates'
import wecomAuthRoutes from './routes/wecom-auth'
import workspaceLayoutsRoutes from './routes/workspace-layouts'
import workspacesRoutes from './routes/workspaces'
import workspacesAfsSharesRoutes from './routes/workspaces/afs-shares'
import { createAgentRoutes } from './routes/workspaces/agent'
import workspacesAgentRequestsRoutes from './routes/workspaces/agent-requests'
import workspacesChatRoutes from './routes/workspaces/chat'
import workspacesCommandsRoutes from './routes/workspaces/commands'
import workspacesLifecycleRoutes from './routes/workspaces/lifecycle'
import workspacesProfileRoutes from './routes/workspaces/profile'
import workspacesReadRoutes from './routes/workspaces/read'
import workspacesSchedulesRoutes from './routes/workspaces/schedules'
import workspacesSessionsRoutes from './routes/workspaces/sessions'
import workspacesTemplatesRoutes from './routes/workspaces/templates'
import workspacesUsageRoutes from './routes/workspaces/usage'
import workspacesWriteRoutes from './routes/workspaces/write'
import { renewToken, shouldRenewToken, verifyToken } from './services/auth'
import { initDb } from './services/db/pool'
import { getServiceTokenByHash } from './services/db/shares'
import { initNotificationQueue } from './services/notifications/queue'

// Initialize database
await initDb()

// Prometheus metrics
import { collectDefaultMetrics, register } from 'prom-client'
collectDefaultMetrics()

const app = new OpenAPIHono<AppEnv>()
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })
app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  description: 'Service token issued via /api/service-tokens',
})

// Response compression (gzip) — automatically skips SSE/streaming (Transfer-Encoding: chunked)
app.use('*', compress())

// HTTP request metrics
import { httpActiveRequests, httpRequestDuration } from './lib/metrics'
app.use('*', async (c, next) => {
  if (c.req.path === '/metrics' || c.req.path.endsWith('/health')) return next()
  httpActiveRequests.inc()
  const start = Date.now()
  await next()
  httpActiveRequests.dec()
  // Use Hono's matched route pattern (e.g. /api/workspaces/:id/...) so dynamic
  // IDs never become label values. Fall back to the raw path on unmatched routes.
  const route = c.req.routePath ?? c.req.path
  httpRequestDuration.observe(
    { method: c.req.method, route, status: String(c.res.status) },
    (Date.now() - start) / 1000,
  )
})

// Middleware — skip logging for health checks and HMR
//
// memory-fuse sidecars poll GET /_cp/workspaces/<id>/memory-stores/<id>/memories
// once per mounted store on a refresh ticker; a healthy fleet would otherwise
// flood the log with identical 200s. Suppress only the successful polls — a
// non-2xx (e.g. 404 "store not attached") still logs so failures stay visible.
const memorySnapshotPoll = /^\/_cp\/workspaces\/[^/]+\/memory-stores\/[^/]+\/memories$/
app.use('*', async (c, next) => {
  const path = c.req.path
  if (path.endsWith('/health') || path === '/metrics' || path === '/__webpack_hmr') return next()
  if (c.req.method === 'GET' && memorySnapshotPoll.test(path)) {
    const start = Date.now()
    await next()
    if (c.res.status >= 400) {
      console.log(`  --> ${c.req.method} ${path} ${c.res.status} ${Date.now() - start}ms`)
    }
    return
  }
  const log = logger()
  return log(c, next)
})

// Host-based sub-app dispatch: files.* is a public, no-auth file export
// host (capability URLs backed by export_tokens). Short-circuit before any
// auth middleware so public requests cannot reach authenticated routes.
app.use('/*', async (c, next) => {
  const host = (c.req.header('host') || '').split(':')[0]
  if (host.startsWith('files.')) {
    return publicExportsApp.fetch(c.req.raw)
  }
  return next()
})

// Auth middleware
app.use('/*', async (c, next) => {
  const path = c.req.path

  // Skip auth for public routes
  if (
    path === '/favicon.svg' ||
    path === '/metrics' ||
    path === '/api/version' ||
    path === '/login' ||
    path === '/api/auth/login' ||
    path === '/api/auth/wecom/enabled' ||
    path === '/api/auth/wecom/authorize' ||
    path === '/api/auth/wecom/callback' ||
    path.startsWith('/api/shares/public/') ||
    path.startsWith('/s/') ||
    path.startsWith('/api/docs') ||
    path.startsWith('/_cp/') ||
    path.startsWith('/_cg/') ||
    path.startsWith('/static/') ||
    path.startsWith('/assets/') ||
    path.startsWith('/badges/') ||
    path.startsWith('/excalidraw-assets/') ||
    path.startsWith('/empty/') ||
    path === '/__webpack_hmr' ||
    path === '/api/oauth/token' ||
    path === '/api/oauth/userinfo' ||
    path === '/mcp'
  ) {
    return next()
  }

  const isApiRequest = path.startsWith('/api/')
  const isProxyRequest = path.startsWith('/_proxy/')

  // CI/rollout bypass for ops admin endpoints — the static PLUGIN_ADMIN_TOKEN
  // env grants both auth and admin role for the route's own check below. No
  // user system involvement. Covers the plugin admin API and the rollout's
  // batch workspace rebuild sweep.
  if (
    (path === '/api/plugins/admin' ||
      path.startsWith('/api/plugins/admin/') ||
      path === '/api/admin/cluster/rebuild-stale') &&
    process.env.PLUGIN_ADMIN_TOKEN
  ) {
    const headerToken = c.req.header('x-plugin-admin-token')
    if (headerToken && headerToken === process.env.PLUGIN_ADMIN_TOKEN) {
      c.set('user', {
        sub: 'plugin-admin',
        username: 'plugin-admin',
        name: 'plugin-admin',
        role: 'admin',
        exp: 0,
      })
      return next()
    }
  }

  // 1. Try Bearer service token (API and proxy requests)
  const authHeader = c.req.header('Authorization')
  if ((isApiRequest || isProxyRequest) && authHeader?.startsWith('Bearer ')) {
    const bearerToken = authHeader.slice(7)
    const tokenRecord = await getServiceTokenByHash(hashToken(bearerToken))
    if (tokenRecord) {
      // Service token authenticated — set a synthetic user payload
      c.set('user', {
        sub: tokenRecord.created_by || 'service',
        username: `svc:${tokenRecord.name}`,
        name: tokenRecord.name,
        role: 'user',
        exp: 0,
      })
      return next()
    }
    // 1b. Bearer wasn't a service token — try as a cp-issued OAuth JWT.
    // This is the consumption side of `issueAccessToken` (same JWT_SECRET +
    // verifier as the session cookie), used by trusted backends like
    // citewright that obtained a per-user token via the RFC 8693 token
    // exchange grant on /api/oauth/token.
    const jwtPayload = await verifyToken(bearerToken)
    if (jwtPayload) {
      c.set('user', jwtPayload)
      return next()
    }
  }

  // 2. Try JWT cookie
  const token = getCookie(c, 'token')

  const buildLoginRedirect = () => {
    const url = new URL(c.req.url)
    const next = path + (url.search || '')
    return next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`
  }

  if (!token) {
    if (isApiRequest) {
      return c.json({ error: 'Unauthorized' }, 401)
    }
    return c.redirect(buildLoginRedirect())
  }

  const payload = await verifyToken(token)
  if (!payload) {
    deleteCookie(c, 'token', { path: '/' })
    if (isApiRequest) {
      return c.json({ error: 'Unauthorized' }, 401)
    }
    return c.redirect(buildLoginRedirect())
  }

  // Sliding session: renew token if it's past the halfway point
  if (shouldRenewToken(payload)) {
    const newToken = await renewToken(payload)
    setCookie(c, 'token', newToken, {
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
      maxAge: 60 * 60 * 24,
      path: '/',
    })
  }

  c.set('user', payload)
  return next()
})

// Global error handler — return JSON instead of crashing
app.onError((err, c) => {
  console.error(`[Error] ${c.req.method} ${c.req.path}:`, err.message)
  return c.json({ error: err.message || 'Internal Server Error' }, 500)
})

// Prometheus metrics endpoint (no auth, no logging)
app.get('/metrics', async () => {
  return new Response(await register.metrics(), {
    headers: { 'Content-Type': register.contentType },
  })
})

// Build version — single source of truth for what this image is. Baked in
// at docker build via rollout.sh (--build-arg GIT_SHA / BUILD_TIME).
app.get('/api/version', (c) =>
  c.json({
    commit: process.env.APP_VERSION || 'dev',
    builtAt: process.env.BUILD_TIME || null,
  }),
)

// Mount routes
app.route('/api/auth', authRoutes)
app.route('/api/auth/wecom', wecomAuthRoutes)
app.route('/api/workspaces', workspacesReadRoutes)
app.route('/api/workspaces', workspacesWriteRoutes)
app.route('/api/workspaces', workspacesLifecycleRoutes)
app.route('/api/workspaces', workspacesTemplatesRoutes)
app.route('/api/workspaces', workspacesSessionsRoutes)
app.route('/api/workspaces', workspacesUsageRoutes)
app.route('/api/workspaces', workspacesRoutes)
app.route('/api/workspaces', workspacesCommandsRoutes)
app.route('/api/workspaces', workspacesChatRoutes)
app.route('/api/workspaces', createAgentRoutes({ upgradeWebSocket }))
app.route('/api/workspaces', workspacesAfsSharesRoutes)
app.route('/api/workspaces', workspacesSchedulesRoutes)
app.route('/api/workspaces', workspacesAgentRequestsRoutes)
app.route('/api/workspaces', workspacesProfileRoutes)
app.route('/api/me', meProfileRoutes)
app.route('/api/me', meRecentSessionsRoutes)
app.route('/api/me', meActivityRoutes)
app.route('/api/me', meUsageRoutes)
app.route('/api/workspaces', jobRoutes)
app.route('/api/credentials', credentialsRoutes)
app.route('/api/workspace-layouts', workspaceLayoutsRoutes)
app.route('/api/prompts', promptsReadRoutes)
app.route('/api/prompts', promptsWriteRoutes)
app.route('/api/service-tokens', serviceTokenRoutes)
app.route('/api/shares', sharesRoutes)
app.route('/api/tags', tagsRoutes)
app.route('/api/teams', teamsRoutes)
app.route('/api/teamwork', teamworkRoutes)
app.route('/api/invites', invitesRoutes)
app.route('/api/batch-runs', batchRunRoutes)
app.route('/api/notifications', notificationsRoutes)
app.route('/api/providers', providersRoutes)
app.route('/api/templates', templatesRoutes)
app.route('/_proxy', createProxyRoutes())
app.route('/_saas', saasProxyRoutes)
app.route('/_cg', cgProxy)
app.route('/api/mcp-oauth', mcpOAuthRoutes)
app.route('/api/oauth', oauthProviderRoutes)
app.route('/api/applications', applicationsRoutes)
app.route('/api/admin', adminRoutes)
app.route('/api/asr', asrRoutes)
app.route('/api/memory-stores', memoryStoresRoutes)
app.route('/api/workspaces', workspaceMemoryAttachmentRoutes)
app.route('/api/skills', skillsRoutes)
app.route('/api/plugins', pluginsRoutes)
app.route('/api/mcp-catalog', mcpCatalogRoutes)
app.route('/api/system-workspaces', systemWorkspacesRoutes)
app.route('/_cp', internalRoutes)
app.route('/_cp', mcpProxyRoutes)

app.doc31('/api/docs/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'NAP Control Plane API',
    version: '0.1.0',
    description: [
      'REST API for the NAP control plane.',
      '',
      '## Authentication',
      '',
      'Requests are authenticated with a NAP Service Token. Create one at [NAP > Integration > Service Tokens](/integration/tokens).',
      '',
      'Pass the token as `Authorization: Bearer tos_...` on every request.',
    ].join('\n'),
  },
  servers: [{ url: '/' }],
})
app.get(
  '/api/docs',
  Scalar({
    url: '/api/docs/openapi.json',
    pageTitle: 'NAP Control Plane API',
    favicon: '/favicon.svg',
    // Disable Scalar's hosted AI / MCP / API client integrations
    agent: { disabled: true },
    mcp: { disabled: true },
    hideClientButton: true,
    hideTestRequestButton: true,
  } as any),
)

// MCP endpoint (auth via X-Workspace-ID header)
app.all('/mcp', async (c) => {
  return handleMcpRequest(c.req.raw)
})

// Static file serving
const WEB_DIST = process.env.WEB_DIST || './web/dist'

// Vite emits /assets/* with content-hashed filenames, so their contents
// never change for a given URL — immutable forever is safe and stops
// the browser from revalidating on every navigation.
app.use(
  '/assets/*',
  serveStatic({
    root: WEB_DIST,
    onFound: (_path, c) => {
      c.header('Cache-Control', 'public, max-age=31536000, immutable')
    },
  }),
)
// A request for /assets/* that the serveStatic above could not resolve means
// a content-hashed chunk that no longer exists on disk — typically a stale
// browser still running a pre-deploy page, dynamically importing an old chunk.
// Return a real 404 instead of letting it fall through to the SPA fallback,
// which would answer with index.html (text/html, 200) and make the browser's
// module loader fail with a confusing MIME-type error. A clean 404 lets the
// client's chunk-load recovery (full reload) kick in instead.
app.get('/assets/*', (c) => c.notFound())
// Unhashed static files: cache for an hour, browsers will revalidate on
// miss. These are small and change rarely.
app.use(
  '/badges/*',
  serveStatic({
    root: WEB_DIST,
    onFound: (_path, c) => {
      c.header('Cache-Control', 'public, max-age=3600')
    },
  }),
)
app.use(
  '/excalidraw-assets/*',
  serveStatic({
    root: WEB_DIST,
    onFound: (_path, c) => {
      c.header('Cache-Control', 'public, max-age=3600')
    },
  }),
)
app.use(
  '/empty/*',
  serveStatic({
    root: WEB_DIST,
    onFound: (_path, c) => {
      c.header('Cache-Control', 'public, max-age=3600')
    },
  }),
)
app.use(
  '/favicon.svg',
  serveStatic({
    root: WEB_DIST,
    path: '/favicon.svg',
    onFound: (_path, c) => {
      c.header('Cache-Control', 'public, max-age=3600')
    },
  }),
)

// SPA fallback - must be LAST
app.get('*', async (c) => {
  const path = c.req.path

  if (
    path.startsWith('/api/') ||
    path.startsWith('/_cp/') ||
    path.startsWith('/_proxy/') ||
    path.startsWith('/_saas/') ||
    path.startsWith('/_cg/')
  ) {
    return c.notFound()
  }

  try {
    const html = await readFile(`${WEB_DIST}/index.html`, 'utf-8')
    // Never cache index.html — it references the latest asset hashes
    // and must be revalidated on every navigation so users pick up new
    // bundles on the next request after deploy.
    c.header('Cache-Control', 'no-cache, no-store, must-revalidate')
    return c.html(html)
  } catch {
    return c.notFound()
  }
})

// Global error handlers — prevent uncaught errors from crashing the process
process.on('uncaughtException', (err) => {
  console.error('[fatal] Uncaught exception (process kept alive):', err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[fatal] Unhandled rejection (process kept alive):', reason)
})

// Graceful shutdown — drain active SSE streams before exiting
import { drainActiveStreams } from './lib/sse'
import { pool } from './services/db/pool'

let shuttingDown = false
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, async () => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`[CP] ${sig} received, draining active streams...`)
    // With recovery picking up orphan sessions on the next CP boot, drain no
    // longer needs to wait minutes for turns to reach session.ended — it
    // only owes callers a short grace period to flush in-flight DB writes.
    await drainActiveStreams(5_000)
    console.log('[CP] Streams drained, shutting down')
    await pool.end()
    process.exit(0)
  })
}

// Start background services.
// Reconcile is disabled in local dev (DISABLE_RECONCILE=1) to avoid fighting
// with the live cluster over the same workspace status rows.
if (process.env.DISABLE_RECONCILE === '1') {
  console.log('[CP] Reconcile loop disabled (DISABLE_RECONCILE=1)')
} else {
  startReconcileLoop()
}
await startJobQueue()
await initNotificationQueue()
await initSkillReloadQueue()

// Recover sessions that were active when CP last crashed/restarted.
// Disabled in local dev (DISABLE_SESSION_RECOVERY=1) to avoid fighting with
// the live cluster over the same session rows.
import { recoverOrphanedSessions } from './lib/session-recovery'
if (process.env.DISABLE_SESSION_RECOVERY === '1') {
  console.log('[CP] Session recovery disabled (DISABLE_SESSION_RECOVERY=1)')
} else {
  recoverOrphanedSessions().catch((e) => console.error('[Recovery] Fatal error:', e))
}

const port = Number.parseInt(process.env.PORT || '3000')
console.log(`Control plane starting on port ${port}`)

const server = serve({ fetch: app.fetch, port })
injectWebSocket(server)

// Debug/profiling server on a separate port — only exposed via ClusterIP Service,
// never routed by the public HTTPProxy.
startPprofServer()
