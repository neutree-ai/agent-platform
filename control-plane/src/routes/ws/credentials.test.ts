import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/db/workspace-tokens', () => ({ verifyWorkspaceToken: vi.fn() }))
vi.mock('../../services/db/credentials', () => ({ listWorkspaceCredentials: vi.fn() }))
vi.mock('../../services/db/workspaces', () => ({ getWorkspace: vi.fn() }))

import { listWorkspaceCredentials } from '../../services/db/credentials'
import { verifyWorkspaceToken } from '../../services/db/workspace-tokens'
import { getWorkspace } from '../../services/db/workspaces'
import ws from './index'

const verify = vi.mocked(verifyWorkspaceToken)
const listCreds = vi.mocked(listWorkspaceCredentials)
const workspace = vi.mocked(getWorkspace)

const CRED = {
  name: 'GITLAB_TOKEN',
  value: 'glpat-secret',
  inject: 'env',
  path: null,
  mode: null,
  scope: 'global',
  status: 'active',
}

function get(path: string, token?: string) {
  return ws.request(path, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined)
}

beforeEach(() => {
  verify.mockReset()
  listCreds.mockReset()
  workspace.mockReset()
  workspace.mockResolvedValue({ id: 'ws1', user_id: 'alice' } as never)
  listCreds.mockResolvedValue([CRED] as never)
})

describe('GET /ws/v1/workspaces/:id/credentials', () => {
  it('serves the workspace its own credentials', async () => {
    verify.mockResolvedValue({ workspaceId: 'ws1' })

    const res = await get('/v1/workspaces/ws1/credentials', 'ws_good')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([CRED])
    // Scoped to the workspace and its owner, not to whoever asked.
    expect(listCreds).toHaveBeenCalledWith('ws1', 'alice')
  })

  // The reason this route exists. On /_cp any caller could name any workspace.
  it('refuses to serve another workspace, valid token or not', async () => {
    verify.mockResolvedValue({ workspaceId: 'ws1' })

    const res = await get('/v1/workspaces/ws2/credentials', 'ws_good')

    expect(res.status).toBe(404)
    // Rejected before any lookup — nothing about ws2 is read, let alone returned.
    expect(workspace).not.toHaveBeenCalled()
    expect(listCreds).not.toHaveBeenCalled()
  })

  it('rejects a request with no token', async () => {
    const res = await get('/v1/workspaces/ws1/credentials')

    expect(res.status).toBe(401)
    expect(listCreds).not.toHaveBeenCalled()
  })

  it('rejects a token that does not verify', async () => {
    verify.mockResolvedValue(null)

    const res = await get('/v1/workspaces/ws1/credentials', 'ws_revoked')

    expect(res.status).toBe(401)
    expect(listCreds).not.toHaveBeenCalled()
  })

  it('404s when the workspace is gone', async () => {
    verify.mockResolvedValue({ workspaceId: 'ws1' })
    workspace.mockResolvedValue(null as never)

    const res = await get('/v1/workspaces/ws1/credentials', 'ws_good')

    expect(res.status).toBe(404)
  })
})
