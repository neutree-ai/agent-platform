import { Hono } from 'hono'
import type { AppEnv } from '../lib/types'
import {
  getWorkspace,
  listCallableWorkspaces,
  markAllSessionsSeen,
  markSessionSeen,
} from '../services/db/workspaces'
import workspaceBrowsers from './workspace-browsers'
import workspaceSandboxes from './workspace-sandboxes'
import { canManage } from './workspaces/_shared'

const workspaces = new Hono<AppEnv>()

// List callable agents (for @mention autocomplete)
workspaces.get('/callable', async (c) => {
  const currentUser = c.get('user')
  const list = await listCallableWorkspaces(currentUser.sub)
  return c.json(
    list.map((w) => ({
      id: w.id,
      slug: w.slug,
      name: w.name,
      owner: w.owner_name,
      visibility: w.visibility,
      is_own: w.user_id === currentUser.sub,
      status: w.status,
    })),
  )
})

// Mark workspace as seen (human → idle)
workspaces.post('/:id/seen', async (c) => {
  const currentUser = c.get('user')
  const id = c.req.param('id')
  const workspace = await getWorkspace(id)

  if (!workspace || !canManage(workspace, currentUser)) {
    return c.json({ error: 'Workspace not found' }, 404)
  }

  const body = await c.req.json().catch(() => ({}))
  if (body.sessionId) {
    const changed = await markSessionSeen(id, body.sessionId)
    return c.json({ success: true, changed })
  }
  // No sessionId: mark all human sessions as seen
  const count = await markAllSessionsSeen(id)
  return c.json({ success: true, changed: count > 0 })
})

// Mount sandbox and browser sub-routes
workspaces.route('/', workspaceSandboxes)
workspaces.route('/', workspaceBrowsers)

export default workspaces
