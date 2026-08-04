import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/db/workspace-tokens', () => ({ verifyWorkspaceToken: vi.fn() }))
vi.mock('../../services/agent-credentials', () => ({ credentialsForWorkspace: vi.fn() }))

import { credentialsForWorkspace } from '../../services/agent-credentials'
import { verifyWorkspaceToken } from '../../services/db/workspace-tokens'
import ws from './index'

const verify = vi.mocked(verifyWorkspaceToken)
const credentials = vi.mocked(credentialsForWorkspace)

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
  credentials.mockReset()
  credentials.mockResolvedValue([CRED] as never)
})

describe('GET /ws/v1/workspaces/:id/credentials', () => {
  it('serves the workspace its own credentials', async () => {
    verify.mockResolvedValue({ workspaceId: 'ws1' })

    const res = await get('/v1/workspaces/ws1/credentials', 'ws_good')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([CRED])
    expect(credentials).toHaveBeenCalledWith('ws1')
  })

  // The reason this route exists. On /_cp any caller could name any workspace.
  it('refuses to serve another workspace, valid token or not', async () => {
    verify.mockResolvedValue({ workspaceId: 'ws1' })

    const res = await get('/v1/workspaces/ws2/credentials', 'ws_good')

    expect(res.status).toBe(404)
    // Rejected before any lookup — nothing about ws2 is read, let alone returned.
    expect(credentials).not.toHaveBeenCalled()
  })

  it('rejects a request with no token', async () => {
    const res = await get('/v1/workspaces/ws1/credentials')

    expect(res.status).toBe(401)
    expect(credentials).not.toHaveBeenCalled()
  })

  it('rejects a token that does not verify', async () => {
    verify.mockResolvedValue(null)

    const res = await get('/v1/workspaces/ws1/credentials', 'ws_revoked')

    expect(res.status).toBe(401)
    expect(credentials).not.toHaveBeenCalled()
  })

  it('404s when the workspace is gone', async () => {
    verify.mockResolvedValue({ workspaceId: 'ws1' })
    credentials.mockResolvedValue(null as never)

    const res = await get('/v1/workspaces/ws1/credentials', 'ws_good')

    expect(res.status).toBe(404)
  })
})
