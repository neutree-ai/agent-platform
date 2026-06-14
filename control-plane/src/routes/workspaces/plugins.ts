import { Hono } from 'hono'
import type { AppEnv } from '../../lib/types'
import {
  installWorkspacePlugin,
  listWorkspacePlugins,
  uninstallWorkspacePlugin,
} from '../../services/db/workspace-plugins'
import { getWorkspace } from '../../services/db/workspaces'
import { canManage } from './_shared'

// Per-workspace UI plugin install state. This is the visibility source that
// replaced the old `entry.id in mcp_config.mcpServers` gate — a panel shows
// because the plugin is installed here, independent of any MCP server.
const plugins = new Hono<AppEnv>()

// List plugins installed in this workspace, resolved to launcher panels.
plugins.get('/:id/plugins', async (c) => {
  const currentUser = c.get('user')
  const id = c.req.param('id')
  const workspace = await getWorkspace(id)
  if (!workspace || !canManage(workspace, currentUser)) {
    return c.json({ error: 'Workspace not found' }, 404)
  }
  return c.json(await listWorkspacePlugins(id))
})

// Install a plugin into this workspace.
plugins.post('/:id/plugins', async (c) => {
  const currentUser = c.get('user')
  const id = c.req.param('id')
  const workspace = await getWorkspace(id)
  if (!workspace || !canManage(workspace, currentUser)) {
    return c.json({ error: 'Workspace not found' }, 404)
  }
  const body = await c.req.json<{ plugin_id?: string }>().catch(() => ({}) as { plugin_id?: string })
  const pluginId = typeof body.plugin_id === 'string' ? body.plugin_id : ''
  if (!pluginId) return c.json({ error: '`plugin_id` is required' }, 400)
  const ok = await installWorkspacePlugin(id, pluginId)
  if (!ok) return c.json({ error: 'Plugin not found' }, 404)
  return c.json({ workspace_id: id, plugin_id: pluginId, installed: true })
})

// Uninstall a plugin from this workspace.
plugins.delete('/:id/plugins/:pluginId', async (c) => {
  const currentUser = c.get('user')
  const id = c.req.param('id')
  const pluginId = c.req.param('pluginId')
  const workspace = await getWorkspace(id)
  if (!workspace || !canManage(workspace, currentUser)) {
    return c.json({ error: 'Workspace not found' }, 404)
  }
  const ok = await uninstallWorkspacePlugin(id, pluginId)
  if (!ok) return c.json({ error: 'Not installed' }, 404)
  return c.json({ success: true })
})

export default plugins
