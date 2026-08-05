import { Hono } from 'hono'
import type { Context } from 'hono'
import { resolveTokenForUser } from '../lib/session-token'
import type { WorkspaceAppEnv } from '../lib/types'
import { caller } from '../middleware/workspace-auth'
import { McpOAuthReauthRequired, getValidAccessToken } from '../services/mcp-oauth'

/**
 * MCP Proxy: transparently forwards MCP traffic from a workspace to upstream MCP
 * servers, injecting OAuth Bearer tokens on every request with on-demand refresh.
 *
 * Route: /workspace/v1/mcp/:encodedOrigin/*
 * - encodedOrigin: base64url-encoded origin of the upstream MCP server
 * - /*: the path on the upstream server (e.g. /mcp, /sse)
 *
 * Whose OAuth tokens get attached comes from the caller's own workspace token,
 * not from the URL. It used to be a path segment naming the owner, which made
 * one workspace's proxy URL into everyone's: edit the segment, borrow another
 * user's upstream access.
 *
 * The caller is the agent server, which holds the workspace token; the coding
 * CLI reaches it over loopback and never sees a credential.
 */
const mcpProxy = new Hono<WorkspaceAppEnv>()

function decodeOrigin(encoded: string): string {
  // base64url decode
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/')
  return atob(padded)
}

export function encodeOrigin(origin: string): string {
  return btoa(origin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Structured 401 telling the agent / UI that this MCP server's refresh_token is
 * permanently dead and the user must re-run the OAuth flow.
 */
function reauthRequired(c: Context, e: McpOAuthReauthRequired) {
  return c.json(
    {
      error: 'needs_reauth',
      server_origin: e.serverOrigin,
      oauth_error: e.oauthError,
      message: `OAuth token for ${e.serverOrigin} is no longer valid; please reconnect this MCP server.`,
    },
    401,
    {
      'WWW-Authenticate': `Bearer realm="mcp", error="invalid_token", error_description="reauth required"`,
    },
  )
}

mcpProxy.all('/v1/mcp/:encodedOrigin/*', async (c) => {
  const { userId } = caller(c)
  const encodedOrigin = c.req.param('encodedOrigin')
  const rest = c.req.path.replace(new RegExp(`^.*?/v1/mcp/${encodedOrigin}`), '')

  let origin: string
  try {
    origin = decodeOrigin(encodedOrigin)
  } catch {
    return c.json({ error: 'Invalid encoded origin' }, 400)
  }

  const targetUrl = `${origin}${rest}`

  // Get fresh OAuth token (auto-refreshes if expired)
  let authHeader: string | undefined
  try {
    const accessToken = await getValidAccessToken(userId, origin)
    if (accessToken) {
      authHeader = `Bearer ${accessToken}`
    }
  } catch (e) {
    if (e instanceof McpOAuthReauthRequired) {
      // Refresh is permanently dead. Don't bother the upstream — return a
      // structured 401 so the agent / UI can prompt the user to reconnect.
      return reauthRequired(c, e)
    }
    // Transient — forward without auth (upstream may still 401, but it's not our call to make)
  }

  // Build upstream request headers (forward most headers, inject auth)
  const upstreamHeaders = new Headers()
  for (const [key, value] of c.req.raw.headers.entries()) {
    // Skip hop-by-hop headers and host
    if (['host', 'connection', 'keep-alive', 'transfer-encoding'].includes(key.toLowerCase()))
      continue
    upstreamHeaders.set(key, value)
  }
  if (authHeader) {
    upstreamHeaders.set('Authorization', authHeader)
  }

  // Translate the internal session-token header into stable identifiers for
  // third-party MCP servers. The raw token is an internal cp ↔ agent secret
  // and must never reach upstream.
  const sessionToken = upstreamHeaders.get('x-session-token')
  if (sessionToken) {
    upstreamHeaders.delete('x-session-token')
    try {
      const record = await resolveTokenForUser(sessionToken, userId)
      if (record) {
        upstreamHeaders.set('X-Workspace-Id', record.workspaceId)
        if (record.sessionId) {
          upstreamHeaders.set('X-Session-Id', record.sessionId)
        }
      } else {
        console.warn(
          `[mcp-proxy] X-Session-Token did not resolve for userId=${userId} (stale/forged/cross-user); forwarding without X-Session-Id`,
        )
      }
    } catch (e) {
      console.warn('[mcp-proxy] session-token resolve failed:', e)
    }
  }

  // Buffer the request body up-front so the request can be retried after a
  // forced token refresh — request streams can only be consumed once. MCP
  // JSON-RPC POST bodies are small, so buffering is cheap.
  const hasBody = !['GET', 'HEAD'].includes(c.req.method)
  let bodyBuffer: ArrayBuffer | undefined
  if (hasBody) {
    try {
      bodyBuffer = await c.req.raw.arrayBuffer()
    } catch {
      bodyBuffer = undefined
    }
  }

  const forwardOnce = (authValue: string | undefined) => {
    const headers = new Headers(upstreamHeaders)
    if (authValue) headers.set('Authorization', authValue)
    else headers.delete('Authorization')
    return fetch(targetUrl, {
      method: c.req.method,
      headers,
      body: bodyBuffer,
      redirect: 'manual',
      signal: c.req.raw.signal,
    })
  }

  // Forward the request, propagating client abort to the upstream connection
  // so that long-lived SSE / streamable-HTTP requests don't leave dangling
  // upstream sockets that later error out with UND_ERR_SOCKET.
  try {
    let upstreamResp = await forwardOnce(authHeader)

    // Upstream rejected the token. cp's pre-flight refresh is lazy — it only
    // refreshes a token cp itself believes is expired. An upstream 401 means
    // the token is actually invalid despite cp thinking otherwise (clock skew,
    // upstream session shorter than the advertised expires_in, revocation).
    // Force a refresh and retry once — critical for short-lived tokens such as
    // google-workspace-mcp's.
    if (upstreamResp.status === 401 && authHeader) {
      try {
        const refreshed = await getValidAccessToken(userId, origin, true)
        if (refreshed) {
          // Drain the rejected response so its upstream socket is released.
          upstreamResp.body?.cancel().catch(() => {})
          upstreamResp = await forwardOnce(`Bearer ${refreshed}`)
        }
      } catch (e) {
        if (e instanceof McpOAuthReauthRequired) {
          upstreamResp.body?.cancel().catch(() => {})
          return reauthRequired(c, e)
        }
        // Transient refresh failure — fall through, return the original 401.
      }
    }

    // Return the upstream response with its headers and streaming body.
    //
    // `content-encoding` / `content-length` are dropped: `fetch` decoded the
    // body before handing it over, so both describe bytes the client will
    // never receive. Passing the encoding through left the client waiting on
    // the rest of a gzip member that was never sent — headers delivered, body
    // hanging. Only compressible replies were affected (an upstream serving
    // `text/event-stream` is not compressed), which is why this surfaced as
    // one MCP server going quiet rather than all of them.
    const responseHeaders = new Headers()
    for (const [key, value] of upstreamResp.headers.entries()) {
      const name = key.toLowerCase()
      if (['transfer-encoding', 'connection', 'content-encoding', 'content-length'].includes(name))
        continue
      responseHeaders.set(key, value)
    }

    // Wrap the upstream body so expected stream-abort errors (client went away,
    // upstream closed a long-lived SSE/streamable-HTTP connection) are swallowed
    // instead of escaping as unhandled undici errors on the Node side.
    const upstreamBody = upstreamResp.body
    const safeBody = upstreamBody
      ? new ReadableStream<Uint8Array>({
          async start(controller) {
            const reader = upstreamBody.getReader()
            try {
              for (;;) {
                const { done, value } = await reader.read()
                if (done) break
                controller.enqueue(value)
              }
              controller.close()
            } catch {
              try {
                controller.close()
              } catch {}
            }
          },
          cancel(reason) {
            upstreamBody.cancel(reason).catch(() => {})
          },
        })
      : null

    const resp = new Response(safeBody, {
      status: upstreamResp.status,
      statusText: upstreamResp.statusText,
      headers: responseHeaders,
    })
    return resp
  } catch (e: any) {
    if (
      e?.name === 'AbortError' ||
      e?.code === 'UND_ERR_SOCKET' ||
      e?.cause?.code === 'UND_ERR_SOCKET'
    ) {
      // Client went away or upstream closed a long-lived stream — expected, not an error.
      return new Response(null, { status: 499 })
    }
    return c.json({ error: `Upstream request failed: ${e.message}` }, 502)
  }
})

export default mcpProxy
