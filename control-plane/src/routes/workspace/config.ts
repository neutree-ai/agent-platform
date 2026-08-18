import { Hono } from 'hono'
import type { ApiWorkspaceConfig } from '../../../../internal/types/api'
import type { WorkspaceAppEnv } from '../../lib/types'
import { caller, requireWorkspaceParam } from '../../middleware/workspace-auth'
import { getMemoryByPath, listAttachmentsForWorkspace } from '../../services/db/memory'
import { getUser } from '../../services/db/users'
import { getWorkspaceConfig } from '../../services/db/workspaces'
import { getToken, serverOriginFromUrl } from '../../services/mcp-oauth'
import { encodeOrigin } from '../mcp-proxy'

// Where the agent server listens for the MCP hop, inside the workspace pod.
// The port is the agent container's, fixed by the pod template.
const AGENT_MCP_FORWARD_URL = 'http://127.0.0.1:3001/mcp'

const config = new Hono<WorkspaceAppEnv>()

// The agent's own workspace config: prompt, model/provider, MCP servers,
// memory attachments. Carries the provider api_key, so it is workspace-scoped
// like the credentials route next door.
config.get('/v1/workspaces/:id/config', requireWorkspaceParam(), async (c) => {
  const id = c.req.param('id')
  const config = await getWorkspaceConfig(id)
  if (!config) {
    return c.json({ error: 'Config not found' }, 404)
  }
  // Inject headers and rewrite URLs in MCP server configs at serve time:
  // 1. X-Workspace-ID for all servers
  // 2. Rewrite URL for OAuth-connected servers, so the traffic reaches cp's
  //    proxy and the upstream token is attached there instead of being handed
  //    down. The rewrite points at the agent server on loopback rather than at
  //    cp directly: this config is passed to the coding CLI as a command-line
  //    argument, which any process in the container can read, so it must not
  //    name anything that would be worth stealing. The agent server holds the
  //    workspace token and adds it on the way out.
  const { userId } = caller(c)
  const user = await getUser(userId)
  let mcpConfig = config.mcp_config
  try {
    const parsed = JSON.parse(mcpConfig)
    if (!parsed.mcpServers) parsed.mcpServers = {}
    // Note: `tos-platform` is no longer injected here. Sidecars are
    // responsible for wiring the platform MCP server per-turn (claude-code)
    // or per-session (codex) so the X-Task-Id header can vary with the
    // teamwork task context. Keeping a static injection here would create
    // a duplicate definition that conflicts with the sidecar's dynamic one.
    if (parsed.mcpServers) {
      for (const server of Object.values(parsed.mcpServers) as any[]) {
        // Inject workspace context for all MCP servers
        if (server.url) {
          server.headers = { ...server.headers, 'X-Workspace-ID': id, 'X-Agent-ID': id }
        }
        // Rewrite URL to CP proxy for servers with OAuth tokens
        if (server.url) {
          try {
            const origin = serverOriginFromUrl(server.url)
            const token = await getToken(userId, origin)
            if (token) {
              const encodedOrig = encodeOrigin(origin)
              const path = new URL(server.url).pathname
              server.url = `${AGENT_MCP_FORWARD_URL}/${encodedOrig}${path}`
            }
          } catch {
            // skip if origin parsing fails
          }
        }
      }
      mcpConfig = JSON.stringify(parsed)
    }
  } catch {
    // leave mcp_config as-is if not valid JSON
  }

  const attachments = await listAttachmentsForWorkspace(id)
  // Snapshot each store's MEMORY.md index so the platform prompt can inline it
  // — saves the agent a `cat` round-trip on session start. Stores without an
  // index report null and the template just omits the block.
  const indexByStore = new Map<string, string | null>()
  await Promise.all(
    attachments.map(async (a) => {
      const m = await getMemoryByPath(a.store_id, '/MEMORY.md')
      indexByStore.set(a.store_id, m?.content ?? null)
    }),
  )
  const response: ApiWorkspaceConfig = {
    agent_type: config.agent_type,
    provider_id: config.provider_id,
    prompt_id: config.prompt_id,
    prompt_name: config.prompt_name,
    prompt_content: config.prompt_content,
    template_id: config.template_id,
    template_version: config.template_version,
    template_name: config.template_name,
    template_latest_version: config.template_latest_version,
    provider_type: config.provider_type,
    model: config.model,
    base_url: config.base_url,
    api_key: config.api_key,
    model_profile: config.model_profile ?? null,
    small_model: config.small_model,
    system_prompt: config.system_prompt,
    mcp_config: mcpConfig,
    agent_settings: config.agent_settings,
    compute_resources: config.compute_resources ?? {},
    auto_start: config.auto_start ?? true,
    muted: config.muted ?? false,
    user_display_name: user?.display_name || user?.username || null,
    memory_attachments: attachments.map((a) => ({
      store_id: a.store_id,
      store_name: a.store_name,
      store_description: a.store_description,
      access: a.access,
      instructions: a.instructions,
      index_content: indexByStore.get(a.store_id) ?? null,
    })),
  }
  return c.json(response)
})

export default config
