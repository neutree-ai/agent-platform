import { makeDefaultProvider } from '../../internal/k8s-provider'
import { pool } from './db'
import { startReconcileLoop } from './reconcile'

// env-runner-k8s: the standalone runner for kind='kubernetes' environments.
// v1 = the built-in (platform) cluster, reached in-cluster (same DB, same k8s),
// no protocol/tunnel. It reconciles actual → desired for each placement (see
// reconcile.ts); cp writes desired, the runner converges.

process.on('uncaughtException', (err) => {
  console.error('[fatal] Uncaught exception (process kept alive):', err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[fatal] Unhandled rejection (process kept alive):', reason)
})

const INTERVAL_MS = Number(process.env.ENV_RUNNER_INTERVAL_MS) || 15_000

const provider = makeDefaultProvider()
console.log(`[env-runner-k8s] starting (reconcile loop, interval ${INTERVAL_MS}ms)`)
const stop = startReconcileLoop(provider, INTERVAL_MS)

const shutdown = async (sig: string) => {
  console.log(`[env-runner-k8s] ${sig} received, shutting down`)
  stop()
  await pool.end()
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
