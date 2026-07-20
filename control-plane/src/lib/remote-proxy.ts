import net from 'node:net'
import { openForwardStream } from '../services/env-gateway/registry'

// Forward data-plane bridge for workspaces on REMOTE environments. cp code
// reaches an agent via getWorkspaceAddress(wsId) → a base URL it fetches. For a
// remote workspace that URL can't be cluster DNS (the pod is across the network,
// behind NAT); instead we run a localhost TCP proxy per remote workspace that
// pipes each connection through the env-gateway tunnel to the pod. The ~11
// forward fetch sites and the terminal WS then work UNCHANGED — they just fetch
// 127.0.0.1:<port>. Built-in workspaces never enter this map, so their path
// stays byte-identical (the red line). The proxy is set up when cp observes a
// remote workspace reachable (wired by projection, P2-D) and torn down on stop.
//
// An auto-scaling remote workspace has 0..N replicas behind a headless Service,
// each reachable per-ordinal. So a remote workspace keeps not one proxy but a
// set, keyed by replica ordinal: a per-ordinal proxy whose tunnel meta carries
// the ordinal (`fwd:<ws>:<id>:<port>`, resolved to the pod's headless DNS on the
// runner), plus — for a static workspace — a single ordinal-less proxy
// (`fwd:<ws>:<port>`, the workspace's Service). Routing (getRemoteProxyPort)
// asks for a specific replica; a workspace-scoped call with no replica affinity
// takes the static proxy, or any replica (shared volume — reads are uniform).

interface RemoteProxy {
  port: number
  server: net.Server
}

// Inner-map key for the ordinal-less (static / workspace-scoped) proxy. Real
// replica ordinals are >= 0, so -1 can't collide.
const STATIC_KEY = -1

/** workspaceId → (replica ordinal | STATIC_KEY) → its localhost proxy. */
const proxies = new Map<string, Map<number, RemoteProxy>>()

/**
 * Local proxy port for a remote workspace. With a `replicaId`, the port of that
 * replica's proxy (undefined if it has none — the caller then fails fast rather
 * than mis-routing a session's turn to the wrong replica). Without one, a
 * workspace-scoped lookup: the static proxy if present, else any replica's (a
 * remote auto-scaling workspace has no static proxy, and its replicas share one
 * volume, so any ready replica answers a workspace-scoped read).
 */
export function getRemoteProxyPort(workspaceId: string, replicaId?: number): number | undefined {
  const inner = proxies.get(workspaceId)
  if (!inner) return undefined
  if (replicaId !== undefined) return inner.get(replicaId)?.port
  const staticProxy = inner.get(STATIC_KEY)
  if (staticProxy) return staticProxy.port
  for (const p of inner.values()) return p.port
  return undefined
}

/**
 * Open one localhost forward proxy for a workspace (or a replica of it), keyed
 * by ordinal. Idempotent per key. Each inbound connection opens a fresh tunnel
 * stream tagged with the forward meta the runner resolves to a pod address.
 */
async function openProxy(
  workspaceId: string,
  environmentId: string,
  replicaId: number | undefined,
  targetPort: number,
): Promise<void> {
  const inner = proxies.get(workspaceId) ?? new Map<number, RemoteProxy>()
  proxies.set(workspaceId, inner)
  const key = replicaId ?? STATIC_KEY
  if (inner.has(key)) return
  const meta =
    replicaId === undefined
      ? `fwd:${workspaceId}:${targetPort}`
      : `fwd:${workspaceId}:${replicaId}:${targetPort}`

  const server = net.createServer((socket) => {
    const stream = openForwardStream(environmentId, meta)
    if (!stream) {
      socket.destroy()
      return
    }
    const kill = () => {
      socket.destroy()
      stream.destroy()
    }
    socket.on('error', kill)
    stream.on('error', kill)
    socket.pipe(stream).pipe(socket)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as net.AddressInfo).port
  inner.set(key, { port, server })
}

/**
 * Ensure the static (single-Service) forward proxy for a remote workspace;
 * returns its base URL. Idempotent. This is the static-workspace path, unchanged.
 */
export async function ensureRemoteProxy(
  workspaceId: string,
  environmentId: string,
  targetPort = 3001,
): Promise<string> {
  const existing = proxies.get(workspaceId)?.get(STATIC_KEY)
  if (existing) return `http://127.0.0.1:${existing.port}`
  await openProxy(workspaceId, environmentId, undefined, targetPort)
  const port = proxies.get(workspaceId)?.get(STATIC_KEY)?.port
  return `http://127.0.0.1:${port}`
}

/**
 * Reconcile a remote auto-scaling workspace's per-replica proxies to `readyIds`:
 * open a proxy for each ready ordinal, and close any proxy that is no longer in
 * the set — including a stale static proxy, should the workspace have briefly
 * looked ordinal-less before its first replica observation. Idempotent.
 */
export async function syncReplicaProxies(
  workspaceId: string,
  environmentId: string,
  readyIds: number[],
  targetPort = 3001,
): Promise<void> {
  const desired = new Set(readyIds)
  const inner = proxies.get(workspaceId)
  if (inner) {
    for (const [key, p] of inner) {
      if (key === STATIC_KEY || !desired.has(key)) {
        p.server.close()
        inner.delete(key)
      }
    }
  }
  for (const id of readyIds) await openProxy(workspaceId, environmentId, id, targetPort)
  if (proxies.get(workspaceId)?.size === 0) proxies.delete(workspaceId)
}

/** Tear down all of a remote workspace's proxies (on stop / destroy / env offline). */
export function dropRemoteProxy(workspaceId: string): void {
  const inner = proxies.get(workspaceId)
  if (!inner) return
  for (const p of inner.values()) p.server.close()
  proxies.delete(workspaceId)
}
