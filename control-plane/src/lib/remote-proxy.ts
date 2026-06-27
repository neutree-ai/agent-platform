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

interface RemoteProxy {
  port: number
  server: net.Server
}

const proxies = new Map<string, RemoteProxy>()

/** Local proxy port for a remote workspace, or undefined if it has none. */
export function getRemoteProxyPort(workspaceId: string): number | undefined {
  return proxies.get(workspaceId)?.port
}

/**
 * Ensure a localhost forward proxy exists for a remote workspace; returns its
 * base URL. Idempotent. Each inbound connection opens a fresh tunnel stream to
 * the workspace's agent port.
 */
export async function ensureRemoteProxy(
  workspaceId: string,
  environmentId: string,
  targetPort = 3001,
): Promise<string> {
  const existing = proxies.get(workspaceId)
  if (existing) return `http://127.0.0.1:${existing.port}`

  const server = net.createServer((socket) => {
    const stream = openForwardStream(environmentId, `fwd:${workspaceId}:${targetPort}`)
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
  proxies.set(workspaceId, { port, server })
  return `http://127.0.0.1:${port}`
}

/** Tear down a remote workspace's proxy (on stop / destroy / env offline). */
export function dropRemoteProxy(workspaceId: string): void {
  const p = proxies.get(workspaceId)
  if (p) {
    p.server.close()
    proxies.delete(workspaceId)
  }
}
