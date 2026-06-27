import { startReconcileLoop } from '../../internal/env-runner-core'
import { makeDefaultProvider } from '../../internal/k8s-provider'
import { pool } from './db'
import { DbTransport } from './db-transport'
import { HttpTransport } from './http-transport'

// env-runner-k8s: the standalone runner for kind='kubernetes' environments. One
// reconcile core (internal/env-runner-core), two shapes selected by RUNNER_MODE:
//   - direct  (default): built-in / same-cluster — in-cluster kubeconfig + a
//             direct-DB transport. Identical to v1 behavior.
//   - remote: BYOI — provider talks to the customer cluster (KUBECONFIG injected
//             into the runner's infra) and a http transport speaks /env/v1 to cp
//             with an env token. No DB access, no inbound connections.
// cp writes desired; the runner converges actual → desired (see reconcile.ts).

process.on('uncaughtException', (err) => {
  console.error('[fatal] Uncaught exception (process kept alive):', err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[fatal] Unhandled rejection (process kept alive):', reason)
})

const INTERVAL_MS = Number(process.env.ENV_RUNNER_INTERVAL_MS) || 15_000
const MODE = process.env.RUNNER_MODE === 'remote' ? 'remote' : 'direct'

// The provider always reaches a cluster; makeDefaultProvider resolves KUBECONFIG
// (set to the customer cluster in remote mode) → in-cluster → default.
const provider = makeDefaultProvider()

let transport: DbTransport | HttpTransport
if (MODE === 'remote') {
  const cpUrl = process.env.CP_URL
  const token = process.env.ENV_TOKEN
  if (!cpUrl || !token) {
    console.error('[env-runner-k8s] remote mode requires CP_URL and ENV_TOKEN')
    process.exit(1)
  }
  transport = new HttpTransport(cpUrl, token)
} else {
  transport = new DbTransport()
}

console.log(`[env-runner-k8s] starting (mode=${MODE}, reconcile interval ${INTERVAL_MS}ms)`)
const stop = startReconcileLoop(provider, transport, INTERVAL_MS)

const shutdown = async (sig: string) => {
  console.log(`[env-runner-k8s] ${sig} received, shutting down`)
  stop()
  if (MODE === 'direct') await pool.end()
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
