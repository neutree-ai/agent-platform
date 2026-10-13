import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/workspace-access', () => ({ canAccessWorkspace: vi.fn() }))
vi.mock('../../services/db/workspaces', () => ({ getWorkspace: vi.fn() }))
vi.mock('../../services/afs', () => ({
  afsEnvForWorkspace: vi.fn(),
  createDir: vi.fn(),
  ensureDefaultFs: vi.fn(),
  mountAtWorkspace: vi.fn(),
  revokeDir: vi.fn(),
  unmountAtWorkspace: vi.fn(),
}))
vi.mock('../../services/db/afs-shares', () => ({
  addAfsShareMember: vi.fn(),
  createAfsShare: vi.fn(),
  deleteAfsShare: vi.fn(),
  getAfsShareById: vi.fn(),
  getAfsShareByName: vi.fn(),
  listAfsShareMembers: vi.fn(),
  listAfsSharesVisibleTo: vi.fn(),
  removeAfsShareMember: vi.fn(),
}))

import { OpenAPIHono } from '@hono/zod-openapi'
import type { AppEnv } from '../../lib/types'
import { canAccessWorkspace } from '../../lib/workspace-access'
import {
  afsEnvForWorkspace,
  createDir,
  mountAtWorkspace,
  unmountAtWorkspace,
} from '../../services/afs'
import {
  addAfsShareMember,
  createAfsShare,
  getAfsShareByName,
  listAfsShareMembers,
} from '../../services/db/afs-shares'
import { getWorkspace } from '../../services/db/workspaces'
import afsShares from './afs-shares'

const env = { environmentId: 'env1', isBuiltin: true }
const share = {
  id: 'share1',
  owner_workspace_id: 'ws1',
  name: 'team',
  afs_dir_id: 'dir1',
  access_key: 'ak1',
  created_at: new Date('2026-01-01T00:00:00Z'),
}

const app = new OpenAPIHono<AppEnv>()
app.use('*', async (c, next) => {
  c.set('user', { sub: 'alice', role: 'user' } as never)
  await next()
})
app.route('/', afsShares)

function create(name: string) {
  return app.request('/ws1/afs/shares', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getWorkspace).mockResolvedValue({ id: 'ws1', user_id: 'alice' } as never)
  vi.mocked(canAccessWorkspace).mockResolvedValue(true)
  vi.mocked(afsEnvForWorkspace).mockResolvedValue(env as never)
  vi.mocked(createDir).mockResolvedValue({ id: 'dir1', accessKey: 'ak1' } as never)
  vi.mocked(createAfsShare).mockResolvedValue(share as never)
  vi.mocked(listAfsShareMembers).mockResolvedValue([])
})

describe('POST /:id/afs/shares', () => {
  it('records a new share, mounts it on the owner and makes the owner a member', async () => {
    vi.mocked(getAfsShareByName).mockResolvedValue(null)

    const res = await create('team')

    expect(res.status).toBe(201)
    expect(createAfsShare).toHaveBeenCalledWith('ws1', 'team', 'dir1', 'ak1')
    expect(mountAtWorkspace).toHaveBeenCalledWith(env, 'ws1', 'dir1', 'ak1', 'team', false)
    expect(addAfsShareMember).toHaveBeenCalledWith('share1', 'ws1', 'read_write')
    expect(unmountAtWorkspace).not.toHaveBeenCalled()
  })

  it('returns a complete share as it is', async () => {
    vi.mocked(getAfsShareByName).mockResolvedValue(share as never)
    vi.mocked(listAfsShareMembers).mockResolvedValue([
      { share_id: 'share1', workspace_id: 'ws1', permission: 'read_write' },
    ] as never)

    const res = await create('team')

    expect(res.status).toBe(201)
    expect(createAfsShare).not.toHaveBeenCalled()
    expect(mountAtWorkspace).not.toHaveBeenCalled()
    expect(addAfsShareMember).not.toHaveBeenCalled()
  })

  it('fails when the mount fails, and the retry finishes the same share', async () => {
    vi.mocked(getAfsShareByName).mockResolvedValueOnce(null)
    vi.mocked(mountAtWorkspace).mockRejectedValueOnce(new Error('workspace is not running'))

    const failed = await create('team')

    expect(failed.status).toBe(502)
    expect(addAfsShareMember).not.toHaveBeenCalled()

    // The record from the failed attempt is still there, without its owner.
    vi.mocked(getAfsShareByName).mockResolvedValue(share as never)

    const retried = await create('team')

    expect(retried.status).toBe(201)
    expect(createAfsShare).toHaveBeenCalledTimes(1)
    expect(mountAtWorkspace).toHaveBeenLastCalledWith(env, 'ws1', 'dir1', 'ak1', 'team', false)
    expect(addAfsShareMember).toHaveBeenCalledWith('share1', 'ws1', 'read_write')
  })

  it('finishes a share whose mount went through but whose membership was not recorded', async () => {
    vi.mocked(getAfsShareByName).mockResolvedValue(share as never)

    const res = await create('team')

    expect(res.status).toBe(201)
    // Unmounted first, since the mount RPC rejects a mountpoint already in use.
    expect(vi.mocked(unmountAtWorkspace).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(mountAtWorkspace).mock.invocationCallOrder[0],
    )
    expect(addAfsShareMember).toHaveBeenCalledWith('share1', 'ws1', 'read_write')
  })
})
