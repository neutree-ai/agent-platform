import { Hono } from 'hono'
import type { AppEnv } from '../lib/types'
import * as browserService from '../services/browser'
import { getPlatformToken } from '../services/db/shares'
import type { Workspace } from '../services/db/types'
import { getWorkspace } from '../services/db/workspaces'

const BROWSER_PUBLIC_URL = process.env.BROWSER_PUBLIC_URL || ''

function canManage(workspace: Workspace, user: { sub: string; role: string }): boolean {
  return workspace.user_id === user.sub || (workspace.is_system && user.role === 'admin')
}

async function getOwnerToken(workspace: { user_id: string }): Promise<string> {
  const token = await getPlatformToken(workspace.user_id)
  if (!token) throw new Error('No platform token for workspace owner')
  return token
}

function withLiveViewUrl<T extends { id: string }>(browser: T, token: string) {
  return {
    ...browser,
    live_view_url: BROWSER_PUBLIC_URL
      ? `${BROWSER_PUBLIC_URL}/live/t/${encodeURIComponent(token)}/${browser.id}/?usr=admin&pwd=admin`
      : null,
  }
}

const workspaceBrowsers = new Hono<AppEnv>()

// Create a browser for a workspace
workspaceBrowsers.post('/:id/browsers', async (c) => {
  const currentUser = c.get('user')
  const id = c.req.param('id')
  const workspace = await getWorkspace(id)

  if (!workspace || !canManage(workspace, currentUser)) {
    return c.json({ error: 'Workspace not found' }, 404)
  }

  try {
    const body = await c.req.json<{ timeout_seconds?: number }>().catch(() => ({}))
    const token = await getOwnerToken(workspace)
    const result = await browserService.createBrowser(token, {
      ...body,
      metadata: { 'browser.workspace_id': id },
    })
    return c.json(withLiveViewUrl(result, token), 201)
  } catch (e: any) {
    console.error('[browser] create failed:', e)
    return c.json({ error: e.message }, 500)
  }
})

// List browsers for a workspace
workspaceBrowsers.get('/:id/browsers', async (c) => {
  const currentUser = c.get('user')
  const id = c.req.param('id')
  const workspace = await getWorkspace(id)

  if (!workspace || !canManage(workspace, currentUser)) {
    return c.json({ error: 'Workspace not found' }, 404)
  }

  try {
    const token = await getOwnerToken(workspace)
    const result = await browserService.listBrowsers(token, {
      'browser.workspace_id': id,
    })
    return c.json({
      items: result.items.map((b: any) => withLiveViewUrl(b, token)),
    })
  } catch (e: any) {
    console.error('[browser] list failed:', e)
    return c.json({ error: e.message }, 500)
  }
})

// Get browser detail
workspaceBrowsers.get('/:id/browsers/:browserId', async (c) => {
  const currentUser = c.get('user')
  const id = c.req.param('id')
  const workspace = await getWorkspace(id)

  if (!workspace || !canManage(workspace, currentUser)) {
    return c.json({ error: 'Workspace not found' }, 404)
  }

  try {
    const token = await getOwnerToken(workspace)
    const result = await browserService.getBrowser(token, c.req.param('browserId'))
    return c.json(withLiveViewUrl(result, token))
  } catch (e: any) {
    console.error('[browser] get failed:', e)
    return c.json({ error: e.message }, 500)
  }
})

// Renew browser expiration
workspaceBrowsers.post('/:id/browsers/:browserId/renew', async (c) => {
  const currentUser = c.get('user')
  const id = c.req.param('id')
  const workspace = await getWorkspace(id)

  if (!workspace || !canManage(workspace, currentUser)) {
    return c.json({ error: 'Workspace not found' }, 404)
  }

  try {
    const body = await c.req
      .json<{ timeout_seconds?: number }>()
      .catch(() => ({}) as { timeout_seconds?: number })
    const token = await getOwnerToken(workspace)
    const result = await browserService.renewBrowser(
      token,
      c.req.param('browserId'),
      body.timeout_seconds,
    )
    return c.json(result)
  } catch (e: any) {
    console.error('[browser] renew failed:', e)
    return c.json({ error: e.message }, 500)
  }
})

// Delete a browser
workspaceBrowsers.delete('/:id/browsers/:browserId', async (c) => {
  const currentUser = c.get('user')
  const id = c.req.param('id')
  const workspace = await getWorkspace(id)

  if (!workspace || !canManage(workspace, currentUser)) {
    return c.json({ error: 'Workspace not found' }, 404)
  }

  try {
    const token = await getOwnerToken(workspace)
    await browserService.deleteBrowser(token, c.req.param('browserId'))
    return c.json({ success: true })
  } catch (e: any) {
    console.error('[browser] delete failed:', e)
    return c.json({ error: e.message }, 500)
  }
})

export default workspaceBrowsers
