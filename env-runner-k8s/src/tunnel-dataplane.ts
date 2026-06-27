import type { Server } from 'node:net'
import type { Duplex } from 'node:stream'
import { type Mux, listenAndTunnel, pipeToTcp } from '../../internal/env-tunnel'

// Runner-side data plane. Two directions over the tunnel mux:
//   - forward (cp→workspace): cp opens `fwd:<wsId>:<port>`; we dial the pod's
//     cluster-DNS in the customer cluster and pipe.
//   - reverse (sidecar→cp): we run local TCP listeners (fronted by a k8s Service
//     in the customer cluster, see F3 manifest); a sidecar's CP_URL /
//     AFS_CONTROLLER points here, and its bytes ride the tunnel back to cp.

const NAMESPACE = process.env.K8S_NAMESPACE || 'default'
const NAME_PREFIX = 'tos' // must match internal/k8s-provider NAME_PREFIX
// Ports cp may reach inside a workspace: agent HTTP, afs-fuse gRPC, memory-fuse gRPC.
const FORWARD_PORTS = new Set([3001, 9101, 9102])

// Reverse listener ports on the runner pod (exposed via a Service in F3).
const CP_PROXY_PORT = Number(process.env.TUNNEL_CP_PROXY_PORT) || 38000
const AFS_PROXY_PORT = Number(process.env.TUNNEL_AFS_PROXY_PORT) || 39100

/** Resolve a forward stream's target pod address, or null if invalid/disallowed. */
function resolveForwardTarget(meta: string): { host: string; port: number } | null {
  const m = /^fwd:([^:]+):(\d+)$/.exec(meta)
  if (!m) return null
  const port = Number(m[2])
  if (!FORWARD_PORTS.has(port)) return null
  return { host: `${NAME_PREFIX}-${m[1]}.${NAMESPACE}.svc.cluster.local`, port }
}

/** Handle a forward stream cp opened: validate, dial the pod, pipe. */
export function forwardDial(stream: Duplex, meta: string): void {
  const target = resolveForwardTarget(meta)
  if (!target) {
    stream.destroy()
    return
  }
  pipeToTcp(stream, target.host, target.port)
}

/**
 * Start the reverse listeners once. `getMux` returns the current tunnel mux (or
 * null while reconnecting), so the listeners survive tunnel reconnects without
 * rebinding ports.
 */
export function startReverseListeners(getMux: () => Mux | null): Server[] {
  return [
    listenAndTunnel(CP_PROXY_PORT, '0.0.0.0', () => getMux()?.openStream('rev:cp') ?? null),
    listenAndTunnel(AFS_PROXY_PORT, '0.0.0.0', () => getMux()?.openStream('rev:afs') ?? null),
  ]
}
