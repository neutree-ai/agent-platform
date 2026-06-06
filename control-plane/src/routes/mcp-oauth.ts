import { Hono } from 'hono'
import type { AppEnv } from '../lib/types'
import { notifyAgentReload } from '../lib/workspace-address'
import { getWorkspace } from '../services/db/workspaces'
import * as mcpOAuth from '../services/mcp-oauth'

const mcpOAuthRoutes = new Hono<AppEnv>()

function callbackUrl(c: { req: { url: string } }): string {
  const u = new URL(c.req.url)
  return `${u.origin}/api/mcp-oauth/callback`
}

// Discover whether an MCP server URL requires OAuth
mcpOAuthRoutes.post('/discover', async (c) => {
  const { url } = await c.req.json<{ url: string }>()
  if (!url) return c.json({ error: 'url is required' }, 400)

  const result = await mcpOAuth.discoverOAuthMetadata(url)
  if (result.status === 'error') {
    return c.json({ error: result.message }, 502)
  }
  if (result.status === 'none') {
    return c.json({ oauth_required: false })
  }
  return c.json({ oauth_required: true, server_origin: result.origin })
})

// Get OAuth connection status for given server origins
mcpOAuthRoutes.get('/status', async (c) => {
  const userId = c.get('user').sub
  const serversParam = c.req.query('servers') ?? ''
  const origins = serversParam.split(',').filter(Boolean)
  if (origins.length === 0) return c.json({})

  const tokens = await mcpOAuth.listTokensForUser(userId)
  const tokenMap = new Map(tokens.map((t) => [t.server_origin, t]))

  const status: Record<string, { connected: boolean; expires_at?: string }> = {}
  for (const origin of origins) {
    const t = tokenMap.get(origin)
    status[origin] = t
      ? { connected: true, expires_at: t.expires_at?.toISOString() }
      : { connected: false }
  }
  return c.json(status)
})

// Start OAuth authorization flow — browser opens this URL directly in a popup
mcpOAuthRoutes.get('/authorize', async (c) => {
  const userId = c.get('user').sub
  const serverOrigin = c.req.query('server_origin')
  const workspaceId = c.req.query('workspace_id')
  if (!serverOrigin || !workspaceId) {
    return c.html(errorPage('server_origin and workspace_id are required'), 400)
  }

  // Discover metadata (or use cached client)
  const discovery = await mcpOAuth.discoverOAuthMetadata(serverOrigin)
  if (discovery.status === 'error') {
    return c.html(errorPage(`Cannot reach MCP server: ${discovery.message}`), 502)
  }
  if (discovery.status === 'none') {
    return c.html(errorPage('OAuth not supported by this server'), 400)
  }

  const cbUrl = callbackUrl(c)
  const client = await mcpOAuth.getOrRegisterClient(discovery.origin, discovery.metadata, cbUrl)
  const { url } = await mcpOAuth.buildAuthorizationUrl(client, userId, workspaceId, cbUrl)
  return c.redirect(url)
})

// OAuth callback — exchanged code for token, stores it, closes popup
mcpOAuthRoutes.get('/callback', async (c) => {
  const code = c.req.query('code')
  const state = c.req.query('state')
  const error = c.req.query('error')

  if (error) {
    return c.html(errorPage(`Authorization denied: ${error}`))
  }
  if (!code || !state) {
    return c.html(errorPage('Missing code or state parameter'), 400)
  }

  const pending = mcpOAuth.consumePendingAuth(state)
  if (!pending) {
    return c.html(errorPage('Invalid or expired authorization state. Please try again.'), 400)
  }

  // Verify the callback user matches the pending auth user
  const userId = c.get('user').sub
  if (userId !== pending.user_id) {
    return c.html(errorPage('User mismatch. Please try again.'), 403)
  }

  try {
    // Look up client
    const discovery = await mcpOAuth.discoverOAuthMetadata(pending.server_origin)
    if (discovery.status !== 'oauth') {
      return c.html(errorPage('Failed to re-discover OAuth metadata'), 500)
    }
    const cbUrl = callbackUrl(c)
    const client = await mcpOAuth.getOrRegisterClient(discovery.origin, discovery.metadata, cbUrl)

    // Exchange code for token
    const tokenData = await mcpOAuth.exchangeCodeForToken(
      client,
      code,
      pending.code_verifier,
      cbUrl,
    )
    await mcpOAuth.upsertToken(userId, pending.server_origin, tokenData)

    // Notify the workspace agent to reload config so mcp.json gets the proxy URL
    const workspace = await getWorkspace(pending.workspace_id)
    if (workspace?.status === 'running') {
      notifyAgentReload(workspace.id, ['config']).catch(() => {})
    }

    // Return HTML that notifies the opener and closes
    return c.html(successPage(pending.server_origin))
  } catch (e: any) {
    console.error('[mcp-oauth] callback error:', e)
    return c.html(errorPage(`Token exchange failed: ${e.message}`), 500)
  }
})

// Disconnect — remove OAuth token
mcpOAuthRoutes.delete('/:serverOrigin', async (c) => {
  const userId = c.get('user').sub
  const serverOrigin = decodeURIComponent(c.req.param('serverOrigin'))
  await mcpOAuth.deleteToken(userId, serverOrigin)
  return c.json({ success: true })
})

export default mcpOAuthRoutes

// ── HTML helpers for the popup callback page ──

function successPage(serverOrigin: string): string {
  return `<!DOCTYPE html>
<html><head><title>Authorization Complete</title></head>
<body>
<p>Authorization successful. This window will close automatically.</p>
<script>
  if (window.opener) {
    window.opener.postMessage({ type: 'mcp-oauth-complete', server_origin: ${JSON.stringify(serverOrigin)} }, '*');
  }
  window.close();
</script>
</body></html>`
}

function errorPage(message: string): string {
  return `<!DOCTYPE html>
<html><head><title>Authorization Failed</title></head>
<body>
<p>${escapeHtml(message)}</p>
<p><button onclick="window.close()">Close</button></p>
</body></html>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
