import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../services/db/workspace-tokens', () => ({ verifyWorkspaceToken: vi.fn() }))

import type { WorkspaceAppEnv } from '../lib/types'
import workspaceProtocolRoutes from '../routes/workspace'
import { verifyWorkspaceToken } from '../services/db/workspace-tokens'
import { callerWorkspaceId, requireWorkspaceParam, workspaceAuth } from './workspace-auth'

const verify = vi.mocked(verifyWorkspaceToken)

/** A router shaped like the real one: token auth, then per-route path binding. */
function makeApp() {
  const app = new Hono<WorkspaceAppEnv>()
  app.use('*', workspaceAuth)
  app.get('/whoami', (c) => c.json({ workspaceId: callerWorkspaceId(c) }))
  app.get('/workspaces/:id/thing', requireWorkspaceParam(), (c) => c.json({ ok: true }))
  app.get('/stores/:wsId/thing', requireWorkspaceParam('wsId'), (c) => c.json({ ok: true }))
  return app
}

beforeEach(() => {
  verify.mockReset()
})

describe('workspaceAuth', () => {
  it('rejects a request with no Authorization header', async () => {
    const res = await makeApp().request('/whoami')

    expect(res.status).toBe(401)
    expect(verify).not.toHaveBeenCalled()
  })

  it('rejects a non-Bearer Authorization header', async () => {
    const res = await makeApp().request('/whoami', { headers: { Authorization: 'Basic abc' } })

    expect(res.status).toBe(401)
    expect(verify).not.toHaveBeenCalled()
  })

  it('rejects a token that does not verify', async () => {
    verify.mockResolvedValue(null)

    const res = await makeApp().request('/whoami', {
      headers: { Authorization: 'Bearer ws_stale' },
    })

    expect(res.status).toBe(401)
  })

  it('passes the bare token to verify and exposes only the workspace id', async () => {
    verify.mockResolvedValue({ workspaceId: 'ws1' })

    const res = await makeApp().request('/whoami', {
      headers: { Authorization: 'Bearer ws_good' },
    })

    expect(verify).toHaveBeenCalledWith('ws_good')
    expect(await res.json()).toEqual({ workspaceId: 'ws1' })
  })
})

describe('the /ws router', () => {
  // Default-deny: the guard sits on the router, not on individual routes, so a
  // path nobody has mounted yet is rejected rather than reaching anything.
  it('rejects an unauthenticated request even where no route is mounted', async () => {
    const res = await workspaceProtocolRoutes.request('/v1/nothing-here')

    expect(res.status).toBe(401)
  })
})

describe('requireWorkspaceParam', () => {
  const asWorkspace = (id: string) => {
    verify.mockResolvedValue({ workspaceId: id })
    return { headers: { Authorization: 'Bearer ws_good' } }
  }

  it('lets a workspace reach its own path', async () => {
    const res = await makeApp().request('/workspaces/ws1/thing', asWorkspace('ws1'))

    expect(res.status).toBe(200)
  })

  // The whole point of the binding: a valid token is not permission to read
  // whatever id the caller types into the path.
  it('answers 404 when the path names another workspace', async () => {
    const res = await makeApp().request('/workspaces/ws2/thing', asWorkspace('ws1'))

    expect(res.status).toBe(404)
    // 404, not 403 — the caller learns nothing about whether ws2 exists.
    expect(await res.json()).toEqual({ error: 'Workspace not found' })
  })

  it('binds an alternately named param', async () => {
    const app = makeApp()

    expect((await app.request('/stores/ws1/thing', asWorkspace('ws1'))).status).toBe(200)
    expect((await app.request('/stores/ws2/thing', asWorkspace('ws1'))).status).toBe(404)
  })
})
