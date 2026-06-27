import type { createNodeWebSocket } from '@hono/node-ws'
import { Hono } from 'hono'
import { type WebSocket as WsWebSocket, createWebSocketStream } from 'ws'
import { Mux, pipeToTcp } from '../../../internal/env-tunnel'
import { verifyEnvironmentToken } from '../services/db/environment-tokens'
import { registerSession, removeSession } from '../services/env-gateway/registry'

// Reverse-flow targets (runner→cp). SYMBOLIC allowlist, not free host:port — a
// runner may only reach these specific cp-internal services, never an arbitrary
// address, so a compromised runner can't pivot through the gateway (design §9).
const CP_INTERNAL_ADDR = process.env.CP_INTERNAL_ADDR || `127.0.0.1:${process.env.PORT || '3000'}`
const AFS_CONTROLLER_ADDR = process.env.AFS_CONTROLLER_ADDR || 'afs-controller.default.svc:9100'

function reverseTarget(meta: string): { host: string; port: number } | null {
  const addr =
    meta === 'rev:cp' ? CP_INTERNAL_ADDR : meta === 'rev:afs' ? AFS_CONTROLLER_ADDR : null
  if (!addr) return null
  const [host, port] = addr.split(':')
  return { host, port: Number(port) }
}

// In-cp env-gateway: the WS terminus a remote runner dials out to. One outbound
// WebSocket per environment carries a byte-level mux (internal/env-tunnel); cp's
// data plane opens forward streams on it to reach NAT'd workspaces, and the
// runner opens reverse streams back to cp (wired in C3). Authn is the env token
// at handshake (design §9 revision): no mTLS for v1, the token already binds the
// connection to a single environment. The raw `ws` socket is wrapped as a Node
// Duplex via createWebSocketStream so the mux gets real stream backpressure.

type UpgradeWebSocket = ReturnType<typeof createNodeWebSocket>['upgradeWebSocket']

export function createEnvGatewayRoutes(deps: { upgradeWebSocket: UpgradeWebSocket }) {
  const { upgradeWebSocket } = deps
  const app = new Hono()

  app.get(
    '/',
    upgradeWebSocket((c) => {
      const auth = c.req.header('authorization')
      const token = auth?.startsWith('Bearer ') ? auth.slice(7) : c.req.query('token')
      let mux: Mux | null = null
      let environmentId: string | null = null

      return {
        async onOpen(_evt, ws) {
          // Auth runs post-upgrade (101 already sent); a bad token closes the
          // socket with 1008 so the runner backs off and retries.
          const principal = token ? await verifyEnvironmentToken(token) : null
          if (!principal) {
            ws.close(1008, 'unauthorized')
            return
          }
          const raw = ws.raw as unknown as WsWebSocket | undefined
          if (!raw) {
            ws.close(1011, 'no raw socket')
            return
          }
          environmentId = principal.environmentId
          const conn = createWebSocketStream(raw)
          conn.on('error', () => {})
          mux = new Mux(conn)
          // Reverse flow (runner→cp): the runner opens a stream tagged with a
          // symbolic target; dial the matching cp-internal service and pipe.
          // Unknown targets are dropped.
          mux.onStreamOpen((stream, meta) => {
            const target = reverseTarget(meta)
            if (!target) {
              stream.destroy()
              return
            }
            pipeToTcp(stream, target.host, target.port)
          })
          registerSession({ environmentId, mux })
          console.log(`[env-gateway] runner connected for environment ${environmentId}`)
        },
        onClose() {
          if (environmentId && mux) removeSession(environmentId, mux)
          mux?.close()
        },
        onError() {
          if (environmentId && mux) removeSession(environmentId, mux)
          mux?.close()
        },
      }
    }),
  )

  return app
}
