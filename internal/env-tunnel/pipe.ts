import net from 'node:net'
import type { Duplex } from 'node:stream'

// Glue between a mux stream (opaque bytes) and a real TCP socket. Used on both
// ends of the tunnel: the runner dials a workspace pod for forward streams, and
// the gateway dials a cp-internal target for reverse streams. The mux never
// parses the bytes — HTTP and gRPC both ride through unchanged.

/** Pipe a mux stream to a freshly dialed TCP target, tearing both down together. */
export function pipeToTcp(stream: Duplex, host: string, port: number): void {
  const socket = net.connect({ host, port })
  const kill = () => {
    socket.destroy()
    stream.destroy()
  }
  socket.on('error', kill)
  stream.on('error', kill)
  socket.pipe(stream).pipe(socket)
}

/**
 * Listen on a local TCP port; for each inbound connection, open a mux stream
 * (via `openStream`) and pipe the two together. The reverse direction: a sidecar
 * connects here, its bytes ride the tunnel back to cp.
 */
export function listenAndTunnel(
  port: number,
  host: string,
  openStream: () => Duplex | null,
): net.Server {
  const server = net.createServer((socket) => {
    const stream = openStream()
    if (!stream) {
      // No live tunnel right now (reconnecting) — refuse the connection.
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
  server.listen(port, host)
  return server
}
