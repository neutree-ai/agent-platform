// The agent server's loopback MCP hop (internal/mcp-forward), shared by cp,
// which points proxied MCP servers at it, and the agents, which serve it.

/** Path the agent server mounts the hop under. */
export const MCP_FORWARD_PATH = '/mcp'

/** Where the coding CLI reaches the hop; cp rewrites proxied MCP URLs to it. */
export const MCP_FORWARD_URL = `http://127.0.0.1:3001${MCP_FORWARD_PATH}`

/**
 * Whether an MCP server URL goes through cp's proxy. Only those may carry the
 * session token: cp turns it into stable ids on the way out, while a server
 * reached directly would receive the internal token itself.
 */
export function isMcpForwardUrl(url: string): boolean {
  return url.startsWith(`${MCP_FORWARD_URL}/`)
}

/**
 * Request headers for a user-configured HTTP MCP server: its own string
 * headers, plus `X-Session-Token` when the server goes through cp's proxy.
 */
export function userMcpHeaders(
  server: { url: string; headers?: Record<string, unknown> },
  sessionToken: string | undefined,
): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(server.headers ?? {})) {
    if (typeof v === 'string') headers[k] = v
  }
  if (sessionToken && isMcpForwardUrl(server.url)) headers['X-Session-Token'] = sessionToken
  return headers
}
