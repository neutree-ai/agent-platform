import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/db/workspace-tokens', () => ({ verifyWorkspaceToken: vi.fn() }))
vi.mock('../../services/db/afs-shares', () => ({ listAfsMountsForWorkspace: vi.fn() }))

import { listAfsMountsForWorkspace } from '../../services/db/afs-shares'
import { verifyWorkspaceToken } from '../../services/db/workspace-tokens'
import ws from './index'

const verify = vi.mocked(verifyWorkspaceToken)
const mounts = vi.mocked(listAfsMountsForWorkspace)

function get(path: string, token?: string) {
  return ws.request(path, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined)
}

beforeEach(() => {
  verify.mockReset()
  mounts.mockReset()
  mounts.mockResolvedValue([
    { afs_dir_id: 'dir1', access_key: 'ak-secret', share_name: 'team', permission: 'read_write' },
  ] as never)
})

describe('GET /workspace/v1/workspaces/:id/afs-mounts', () => {
  it('serves the sidecar its own mount set', async () => {
    verify.mockResolvedValue({ workspaceId: 'ws1' })

    const res = await get('/v1/workspaces/ws1/afs-mounts', 'ws_good')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      mounts: [
        { id: 'dir1', access_key: 'ak-secret', mountpoint: '/mnt/afs/team', readonly: false },
      ],
    })
  })

  // The entries carry share access keys, which is why this one moved.
  it('refuses to serve another workspace, valid token or not', async () => {
    verify.mockResolvedValue({ workspaceId: 'ws1' })

    const res = await get('/v1/workspaces/ws2/afs-mounts', 'ws_good')

    expect(res.status).toBe(404)
    expect(mounts).not.toHaveBeenCalled()
  })

  it('rejects a request with no token', async () => {
    const res = await get('/v1/workspaces/ws1/afs-mounts')

    expect(res.status).toBe(401)
    expect(mounts).not.toHaveBeenCalled()
  })

  it('marks a read-only share readonly', async () => {
    verify.mockResolvedValue({ workspaceId: 'ws1' })
    mounts.mockResolvedValue([
      { afs_dir_id: 'dir1', access_key: 'ak', share_name: 'ro', permission: 'read_only' },
    ] as never)

    const res = await get('/v1/workspaces/ws1/afs-mounts', 'ws_good')

    expect(await res.json()).toMatchObject({ mounts: [{ readonly: true }] })
  })
})
