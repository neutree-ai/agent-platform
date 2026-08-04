/**
 * The workspace's MCP hop.
 *
 * A coding CLI reaches its MCP servers through cp, so cp can attach the user's
 * upstream OAuth token without ever handing it down. cp's proxy needs the
 * workspace token to know whose tokens those are — but the CLI receives its MCP
 * configuration as a command-line argument, and argv is readable by anything
 * running in the container, including the shell commands the model writes. A
 * credential placed there is a credential given away.
 *
 * So the CLI is pointed at this loopback endpoint instead. It carries nothing
 * worth stealing: the agent server holds the token and adds it on the way out.
 * What the CLI ends up with is reachability from inside the pod, which it
 * already has, rather than a string it could send anywhere.
 *
 * Framework-agnostic like the other shared route modules — the caller mounts it
 * on its own Hono app.
 */

interface RouteApp {
  all(path: string, handler: (c: any) => any): void
}

export interface McpForwardDeps {
  /** Control-plane base URL. */
  cpUrl: string
  /** Headers carrying the workspace token. Called per request so a reload lands. */
  authHeaders: () => Record<string, string>
}

/** Hop-by-hop headers, meaningless to re-send on a new connection. */
const HOP_BY_HOP = ['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'host']

/**
 * Mount the hop at `prefix` (e.g. '/mcp'). Everything under it is forwarded to
 * cp's proxy verbatim apart from the added credential — MCP traffic is
 * long-lived SSE / streamable HTTP, so request and response bodies stream
 * rather than buffer, and a client that goes away aborts the upstream leg
 * instead of leaving it dangling.
 */
export function registerMcpForwardRoutes(
  app: RouteApp,
  prefix: string,
  deps: McpForwardDeps,
): void {
  app.all(`${prefix}/*`, async (c: any) => {
    const tail = c.req.path.slice(prefix.length)
    const url = new URL(c.req.url)
    const target = `${deps.cpUrl.replace(/\/+$/, '')}/workspace/v1/mcp${tail}${url.search}`

    const headers = new Headers()
    for (const [k, v] of c.req.raw.headers.entries()) {
      if (!HOP_BY_HOP.includes(k.toLowerCase())) headers.set(k, v)
    }
    for (const [k, v] of Object.entries(deps.authHeaders())) headers.set(k, v)

    const method = c.req.method
    const body = ['GET', 'HEAD'].includes(method) ? undefined : await c.req.raw.arrayBuffer()

    let upstream: Response
    try {
      upstream = await fetch(target, {
        method,
        headers,
        body,
        redirect: 'manual',
        signal: c.req.raw.signal,
      })
    } catch (e: any) {
      // The client hanging up mid-stream is how these requests normally end.
      if (e?.name === 'AbortError') return new Response(null, { status: 499 })
      return c.json({ error: `MCP forward failed: ${e?.message ?? e}` }, 502)
    }

    const respHeaders = new Headers()
    for (const [k, v] of upstream.headers.entries()) {
      if (!HOP_BY_HOP.includes(k.toLowerCase())) respHeaders.set(k, v)
    }
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: respHeaders,
    })
  })
}
