import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { logger } from 'hono/logger'
import * as slack from './connectors/slack'
import { createWebhookRouter } from './connectors/webhook'
import * as wecom from './connectors/wecom'
import { verifyToken } from './lib/auth'
import type { AppEnv } from './lib/types'
import * as relay from './relay'
import connectorsApi from './routes/connectors'
import eventsApi from './routes/events'
import routesApi from './routes/routes'
import sendApi from './routes/send'
import sessionsApi from './routes/sessions'
import * as db from './services/db'

process.on('uncaughtException', (err) => {
  console.error('[fatal] Uncaught exception (process kept alive):', err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[fatal] Unhandled rejection (process kept alive):', reason)
})

// Initialize database
await db.initDb()

const app = new Hono<AppEnv>()

// Logging: skip health checks; for high-frequency /internal/* (scheduler→cg
// streaming), only log on errors so 200s don't drown the log.
app.use('*', async (c, next) => {
  if (c.req.path === '/health') return next()
  if (c.req.path.startsWith('/internal/')) {
    await next()
    if (c.res.status >= 400) {
      console.error(`${c.req.method} ${c.req.path} -> ${c.res.status}`)
    }
    return
  }
  const log = logger()
  return log(c, next)
})

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }))

// Auth middleware for API routes
app.use('/api/*', async (c, next) => {
  const token = getCookie(c, 'token')
  if (!token) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const payload = await verifyToken(token)
  if (!payload) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  c.set('user', payload)
  return next()
})

// API routes (authenticated)
const api = new Hono<AppEnv>()
api.route('/connectors', connectorsApi)
api.route('/routes', routesApi)
api.route('/events', eventsApi)
api.route('/sessions', sessionsApi)
app.route('/api', api)

// Internal routes (no auth, service-to-service only)
app.route('/internal/connectors', sendApi)

// Webhook ingestion (no auth — validated by connector secret)
app.route('/webhook', createWebhookRouter())

// Graceful shutdown
const shutdown = async () => {
  console.log('[ChannelGateway] Shutting down...')
  await relay.stopAll()
  await wecom.stopAll()
  console.log('[ChannelGateway] All connectors stopped')
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

// Start HTTP server first so /health responds immediately — probes must not
// wait for external WS handshakes (Slack/WeCom) to complete.
const port = Number.parseInt(process.env.PORT || '3002')
console.log(`[ChannelGateway] API server on port ${port}`)
serve({ fetch: app.fetch, port })

// Initialize connectors in background. Failures are logged per-connector
// inside startAll; we never want one bad bot to block the server from serving.
console.log('[ChannelGateway] Starting connectors...')
Promise.all([slack.startAll(), wecom.startAll(), relay.startAll()])
  .then(() => console.log('[ChannelGateway] All connectors initialized'))
  .catch((e) => console.error('[ChannelGateway] Connector init error:', e))
