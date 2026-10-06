import { serve } from '@hono/node-server'
import { collectDefaultMetrics } from 'prom-client'
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici'
import { app, injectWebSocket } from './app'
import { startJobQueue } from './lib/jobs'
import { startPprofServer } from './lib/pprof-server'
import { startReconcileLoop } from './lib/reconcile'
import { recoverOrphanedSessions } from './lib/session-recovery'
import { initSkillReloadQueue } from './lib/skill-reload-queue'
import { drainActiveStreams } from './lib/sse'
import { initDb, pool } from './services/db/pool'
import { initNotificationQueue } from './services/notifications/queue'

setGlobalDispatcher(new EnvHttpProxyAgent())

// Initialize database
await initDb()

// Prometheus metrics
collectDefaultMetrics()

// Global error handlers — prevent uncaught errors from crashing the process
process.on('uncaughtException', (err) => {
  console.error('[fatal] Uncaught exception (process kept alive):', err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[fatal] Unhandled rejection (process kept alive):', reason)
})

// Graceful shutdown — drain active SSE streams before exiting

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
if (process.env.DISABLE_SESSION_RECOVERY === '1') {
  console.log('[CP] Session recovery disabled (DISABLE_SESSION_RECOVERY=1)')
} else {
  recoverOrphanedSessions().catch((e) => console.error('[Recovery] Fatal error:', e))
}

const port = Number.parseInt(process.env.PORT || '3000')
console.log(`Control plane starting on port ${port}`)

// Node's http server defaults `requestTimeout` to 5 minutes, counted from the
// first byte until the request body is fully received. File uploads stream
// through here (PUT /workspaces/:id/agent/files), so on a slow uplink a large
// file trips the default and the client gets a 408 mid-body — the bytes never
// reach the agent. 30 minutes covers a ~100MB upload at dial-up-grade speed
// while still bounding a stalled request, which is what the timeout is for.
const server = serve({
  fetch: app.fetch,
  port,
  serverOptions: { requestTimeout: 30 * 60 * 1000 },
})
injectWebSocket(server)

// Debug/profiling server on a separate port — only exposed via ClusterIP Service,
// never routed by the public HTTPProxy.
startPprofServer()
