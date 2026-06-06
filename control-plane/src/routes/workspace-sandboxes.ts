import { Hono } from 'hono'
import type { AppEnv } from '../lib/types'
import { getPlatformToken } from '../services/db/shares'
import type { Workspace } from '../services/db/types'
import { getWorkspace } from '../services/db/workspaces'
import * as sandbox from '../services/sandbox'

function canManage(workspace: Workspace, user: { sub: string; role: string }): boolean {
  return workspace.user_id === user.sub || (workspace.is_system && user.role === 'admin')
}

// Look up (or lazy-mint) the workspace owner's platform service token, the
// same mechanism browser-routes use. Lets us forward a real per-user
// bearer to sandbox-service even on cookie-authenticated UI requests, so
// the downstream sees the real user identity (instead of a synthetic
// service principal) for quota / audit / future per-user enforcement.
async function getOwnerToken(workspace: { user_id: string }): Promise<string> {
  const token = await getPlatformToken(workspace.user_id)
  if (!token) throw new Error('No platform token for workspace owner')
  return token
}

const workspaceSandboxes = new Hono<AppEnv>()

// Create a sandbox for a workspace
workspaceSandboxes.post('/:id/sandboxes', async (c) => {
  const currentUser = c.get('user')
  const id = c.req.param('id')
  const workspace = await getWorkspace(id)

  if (!workspace || !canManage(workspace, currentUser)) {
    return c.json({ error: 'Workspace not found' }, 404)
  }

  try {
    const body = await c.req.json<{
      image: string
      resource?: Record<string, string>
      timeout_seconds?: number
      env?: Record<string, string>
    }>()
    const token = await getOwnerToken(workspace)
    const info = await sandbox.createSandbox(token, {
      image: body.image,
      resource: body.resource,
      timeoutSeconds: body.timeout_seconds,
      env: body.env,
      metadata: { workspace_id: id },
    })
    return c.json(info, 201)
  } catch (e: any) {
    console.error('[sandbox] create failed:', e)
    return c.json({ error: e.message }, 500)
  }
})

// List sandboxes for a workspace
workspaceSandboxes.get('/:id/sandboxes', async (c) => {
  const currentUser = c.get('user')
  const id = c.req.param('id')
  const workspace = await getWorkspace(id)

  if (!workspace || !canManage(workspace, currentUser)) {
    return c.json({ error: 'Workspace not found' }, 404)
  }

  try {
    const token = await getOwnerToken(workspace)
    const result = await sandbox.listSandboxes(token, {
      metadata: { workspace_id: id },
    })
    return c.json(result)
  } catch (e: any) {
    console.error('[sandbox] list failed:', e)
    return c.json({ error: e.message }, 500)
  }
})

// Get sandbox endpoint URL for a port
workspaceSandboxes.get('/:id/sandboxes/:sandboxId/endpoint/:port', async (c) => {
  const currentUser = c.get('user')
  const id = c.req.param('id')
  const workspace = await getWorkspace(id)

  if (!workspace || !canManage(workspace, currentUser)) {
    return c.json({ error: 'Workspace not found' }, 404)
  }

  try {
    const token = await getOwnerToken(workspace)
    const sandboxId = c.req.param('sandboxId')
    const port = Number.parseInt(c.req.param('port'), 10)
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      return c.json({ error: 'Invalid port number' }, 400)
    }
    const url = await sandbox.getEndpoint(token, sandboxId, port)
    return c.json({ sandbox_id: sandboxId, port, url })
  } catch (e: any) {
    console.error('[sandbox] get endpoint failed:', e)
    return c.json({ error: e.message }, 500)
  }
})

// Kill a workspace sandbox
workspaceSandboxes.delete('/:id/sandboxes/:sandboxId', async (c) => {
  const currentUser = c.get('user')
  const id = c.req.param('id')
  const workspace = await getWorkspace(id)

  if (!workspace || !canManage(workspace, currentUser)) {
    return c.json({ error: 'Workspace not found' }, 404)
  }

  try {
    const token = await getOwnerToken(workspace)
    await sandbox.deleteSandbox(token, c.req.param('sandboxId'))
    return c.json({ success: true })
  } catch (e: any) {
    console.error('[sandbox] delete failed:', e)
    return c.json({ error: e.message }, 500)
  }
})

export default workspaceSandboxes
