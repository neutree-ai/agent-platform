import type { Duplex } from 'node:stream'
import { WebSocket, createWebSocketStream } from 'ws'
import { Mux } from '../../internal/env-tunnel'

// The runner-side tunnel client (remote mode). Dials ONE outbound WebSocket to
// cp's env-gateway, authenticated by the env token, and runs a byte-level mux
// over it. Forward streams (cp→workspace) arrive via onStream; reverse streams
// (workspace→cp) are opened with mux.openStream. The raw socket is wrapped as a
// Node Duplex so the mux gets real backpressure. Outbound only — works behind
// NAT. See tmp/byoi-environments-design.md §6.

interface TunnelClient {
  mux: Mux
  close(): void
}

export function connectTunnel(opts: {
  /** ws(s)://<cp-host>/env-gateway */
  gatewayUrl: string
  token: string
  /** Forward streams opened by cp; the caller dials the pod and pipes. */
  onStream: (stream: Duplex, meta: string) => void
  /** Fired once when the tunnel drops, so the caller can reconnect. */
  onClose?: () => void
}): Promise<TunnelClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(opts.gatewayUrl, {
      headers: { Authorization: `Bearer ${opts.token}` },
    })
    ws.binaryType = 'nodebuffer'

    ws.on('open', () => {
      const conn = createWebSocketStream(ws)
      conn.on('error', () => {})
      const mux = new Mux(conn)
      mux.onStreamOpen(opts.onStream)
      resolve({
        mux,
        close: () => {
          mux.close()
          ws.close()
        },
      })
    })
    ws.on('close', () => opts.onClose?.())
    ws.on('error', (err) => reject(err))
    ws.on('unexpected-response', (_req, res) =>
      reject(new Error(`tunnel handshake failed: ${res.statusCode}`)),
    )
  })
}
