import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/workspace-access', () => ({
  canAccessWorkspace: vi.fn(),
  isWorkspaceOwner: (w: { user_id: string }, u: { sub: string }) => w.user_id === u.sub,
}))
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
  addAfsTeamMount: vi.fn(),
  createAfsShare: vi.fn(),
  deleteAfsShare: vi.fn(),
  deleteAfsShareGrant: vi.fn(),
  getAfsGrantCeiling: vi.fn(),
  getAfsShareById: vi.fn(),
  getAfsShareByName: vi.fn(),
  listAfsMountNames: vi.fn(),
  listAfsShareGrants: vi.fn(),
  listAfsShareMemberDetails: vi.fn(),
  getAfsShareMember: vi.fn(),
  listAfsShareMembers: vi.fn(),
  listAfsSharesAvailableTo: vi.fn(),
  listAfsSharesOwnedBy: vi.fn(),
  listAfsSharesVisibleTo: vi.fn(),
  listAfsTeamMountsOutOfLine: vi.fn(),
  removeAfsShareMember: vi.fn(),
  setAfsMemberPermission: vi.fn(),
  upsertAfsShareGrant: vi.fn(),
}))
vi.mock('../../services/db/teams', () => ({ getTeamMembership: vi.fn() }))

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
  addAfsTeamMount,
  createAfsShare,
  deleteAfsShareGrant,
  getAfsGrantCeiling,
  getAfsShareById,
  getAfsShareByName,
  getAfsShareMember,
  listAfsMountNames,
  listAfsShareMemberDetails,
  listAfsShareMembers,
  listAfsSharesVisibleTo,
  listAfsTeamMountsOutOfLine,
  removeAfsShareMember,
  setAfsMemberPermission,
  upsertAfsShareGrant,
} from '../../services/db/afs-shares'
import { getTeamMembership } from '../../services/db/teams'
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
  vi.mocked(listAfsMountNames).mockResolvedValue([])
  vi.mocked(listAfsTeamMountsOutOfLine).mockResolvedValue([])
  vi.mocked(listAfsSharesVisibleTo).mockResolvedValue([
    {
      ...share,
      role: 'owner',
      my_permission: 'read_write',
      mount_name: 'team',
      source: 'direct',
      owner_user_id: 'alice',
      owner_display_name: 'Alice',
      other_member_count: 0,
      grant_count: 0,
    },
  ])
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
    vi.mocked(getAfsShareMember).mockResolvedValue({
      share_id: 'share1',
      workspace_id: 'ws1',
      permission: 'read_write',
    } as never)

    const res = await create('team')

    expect(res.status).toBe(201)
    expect(createAfsShare).not.toHaveBeenCalled()
    expect(mountAtWorkspace).not.toHaveBeenCalled()
    expect(addAfsShareMember).not.toHaveBeenCalled()
  })

  it('makes an owner that is only a read-only member a read-write one', async () => {
    vi.mocked(getAfsShareByName).mockResolvedValue(share as never)
    vi.mocked(getAfsShareMember).mockResolvedValue({
      share_id: 'share1',
      workspace_id: 'ws1',
      permission: 'read_only',
    } as never)

    const res = await create('team')

    expect(res.status).toBe(201)
    expect(createAfsShare).not.toHaveBeenCalled()
    expect(mountAtWorkspace).toHaveBeenCalledWith(env, 'ws1', 'dir1', 'ak1', 'team', false)
    expect(addAfsShareMember).toHaveBeenCalledWith('share1', 'ws1', 'read_write')
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

// ── Team sharing ────────────────────────────────────────────────────────────
//
// alice owns ws1 and its folder `team`; bob has ws2. Grants go to teams; bob
// mounts the folder in ws2 through a grant to a team he is in.

const workspaces: Record<string, { id: string; user_id: string; status: string }> = {
  ws1: { id: 'ws1', user_id: 'alice', status: 'running' },
  ws2: { id: 'ws2', user_id: 'bob', status: 'running' },
  ws3: { id: 'ws3', user_id: 'bob', status: 'stopped' },
}

function teamApp(sub: string) {
  const a = new OpenAPIHono<AppEnv>()
  a.use('*', async (c, next) => {
    c.set('user', { sub, role: 'user' } as never)
    await next()
  })
  a.route('/', afsShares)
  return a
}

function json(method: string, body?: unknown) {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }
}

function teamMount(
  over: Partial<{ permission: string; mount_name: string; ceiling: string | null }>,
) {
  return {
    share,
    workspace_id: 'ws2',
    permission: 'read_write',
    mount_name: 'alice-team',
    ceiling: null,
    ...over,
  } as never
}

describe('team grants', () => {
  beforeEach(() => {
    vi.mocked(getWorkspace).mockImplementation(async (id) => (workspaces[id] ?? null) as never)
    vi.mocked(getAfsShareById).mockResolvedValue(share as never)
  })

  it('lets the owner grant the folder to a team they are in', async () => {
    vi.mocked(getTeamMembership).mockResolvedValue({ role: 'member' } as never)

    const res = await teamApp('alice').request(
      '/ws1/afs/shares/share1/grants/t1',
      json('PUT', { permission: 'read_write' }),
    )

    expect(res.status).toBe(200)
    expect(getTeamMembership).toHaveBeenCalledWith('t1', 'alice')
    expect(upsertAfsShareGrant).toHaveBeenCalledWith('share1', 't1', 'read_write', 'alice')
  })

  it("refuses a team the owner isn't in", async () => {
    vi.mocked(getTeamMembership).mockResolvedValue(null)

    const res = await teamApp('alice').request(
      '/ws1/afs/shares/share1/grants/t1',
      json('PUT', { permission: 'read_only' }),
    )

    expect(res.status).toBe(403)
    expect(upsertAfsShareGrant).not.toHaveBeenCalled()
  })

  it('refuses someone the workspace is shared with, who is not its owner', async () => {
    vi.mocked(getTeamMembership).mockResolvedValue({ role: 'member' } as never)

    const res = await teamApp('carol').request(
      '/ws1/afs/shares/share1/grants/t1',
      json('PUT', { permission: 'read_only' }),
    )

    expect(res.status).toBe(403)
    expect(upsertAfsShareGrant).not.toHaveBeenCalled()
  })

  it('refuses granting a folder another workspace owns', async () => {
    vi.mocked(getAfsShareById).mockResolvedValue({ ...share, owner_workspace_id: 'ws9' } as never)

    const res = await teamApp('alice').request(
      '/ws1/afs/shares/share1/grants/t1',
      json('PUT', { permission: 'read_only' }),
    )

    expect(res.status).toBe(403)
  })

  it('unmounts the mounts no grant allows any more once a grant goes', async () => {
    vi.mocked(deleteAfsShareGrant).mockResolvedValue(true)
    vi.mocked(listAfsTeamMountsOutOfLine).mockResolvedValue([teamMount({ ceiling: null })])

    const res = await teamApp('alice').request('/ws1/afs/shares/share1/grants/t1', json('DELETE'))

    expect(res.status).toBe(200)
    expect(removeAfsShareMember).toHaveBeenCalledWith('share1', 'ws2')
    // At the member's own mount name, not the folder's.
    expect(unmountAtWorkspace).toHaveBeenCalledWith(env, 'ws2', 'alice-team')
    expect(mountAtWorkspace).not.toHaveBeenCalled()
  })

  it('mounts a read-write mount again read-only when only read-only grants are left', async () => {
    vi.mocked(getTeamMembership).mockResolvedValue({ role: 'member' } as never)
    vi.mocked(listAfsTeamMountsOutOfLine).mockResolvedValue([teamMount({ ceiling: 'read_only' })])

    const res = await teamApp('alice').request(
      '/ws1/afs/shares/share1/grants/t1',
      json('PUT', { permission: 'read_only' }),
    )

    expect(res.status).toBe(200)
    expect(setAfsMemberPermission).toHaveBeenCalledWith('share1', 'ws2', 'read_only')
    expect(removeAfsShareMember).not.toHaveBeenCalled()
    expect(unmountAtWorkspace).toHaveBeenCalledTimes(1)
    expect(unmountAtWorkspace).toHaveBeenCalledWith(env, 'ws2', 'alice-team')
    expect(mountAtWorkspace).toHaveBeenCalledWith(env, 'ws2', 'dir1', 'ak1', 'alice-team', true)
  })

  it('keeps reconciling the other mounts when one fails', async () => {
    vi.mocked(deleteAfsShareGrant).mockResolvedValue(true)
    vi.mocked(listAfsTeamMountsOutOfLine).mockResolvedValue([
      teamMount({ ceiling: null }),
      teamMount({ ceiling: null, mount_name: 'second' }),
    ])
    vi.mocked(removeAfsShareMember).mockRejectedValueOnce(new Error('db down'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await teamApp('alice').request('/ws1/afs/shares/share1/grants/t1', json('DELETE'))

    expect(res.status).toBe(200)
    expect(removeAfsShareMember).toHaveBeenCalledTimes(2)
    expect(unmountAtWorkspace).toHaveBeenCalledWith(env, 'ws2', 'second')
    error.mockRestore()
  })
})

describe('POST /:id/afs/mounts', () => {
  beforeEach(() => {
    vi.mocked(getWorkspace).mockImplementation(async (id) => (workspaces[id] ?? null) as never)
    vi.mocked(getAfsShareById).mockResolvedValue(share as never)
  })

  const mount = (ws: string, body: unknown) =>
    teamApp('bob').request(`/${ws}/afs/mounts`, json('POST', body))

  it('mounts a folder granted to a team of the workspace owner in a running workspace', async () => {
    vi.mocked(getAfsGrantCeiling).mockResolvedValue('read_write')

    const res = await mount('ws2', { share_id: 'share1', permission: 'read_write' })

    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({
      share_id: 'share1',
      permission: 'read_write',
      mount_name: 'team',
    })
    expect(getAfsGrantCeiling).toHaveBeenCalledWith('share1', 'bob')
    expect(mountAtWorkspace).toHaveBeenCalledWith(env, 'ws2', 'dir1', 'ak1', 'team', false)
    expect(addAfsTeamMount).toHaveBeenCalledWith('share1', 'ws2', 'read_write', 'team')
  })

  it('records the mount of a stopped workspace for when it starts', async () => {
    vi.mocked(getAfsGrantCeiling).mockResolvedValue('read_only')

    const res = await mount('ws3', { share_id: 'share1' })

    expect(res.status).toBe(201)
    expect(mountAtWorkspace).not.toHaveBeenCalled()
    expect(addAfsTeamMount).toHaveBeenCalledWith('share1', 'ws3', 'read_only', 'team')
  })

  it('refuses a folder not granted to any team of the workspace owner', async () => {
    vi.mocked(getAfsGrantCeiling).mockResolvedValue(null)

    const res = await mount('ws2', { share_id: 'share1' })

    expect(res.status).toBe(403)
    expect(addAfsTeamMount).not.toHaveBeenCalled()
  })

  it('refuses read-write when the grants only allow read-only', async () => {
    vi.mocked(getAfsGrantCeiling).mockResolvedValue('read_only')

    const res = await mount('ws2', { share_id: 'share1', permission: 'read_write' })

    expect(res.status).toBe(403)
    expect(mountAtWorkspace).not.toHaveBeenCalled()
  })

  it('refuses a name the workspace already has a folder at, and takes another', async () => {
    vi.mocked(getAfsGrantCeiling).mockResolvedValue('read_only')
    vi.mocked(listAfsMountNames).mockResolvedValue(['team'])

    const taken = await mount('ws2', { share_id: 'share1' })
    expect(taken.status).toBe(409)

    const renamed = await mount('ws2', { share_id: 'share1', mount_name: 'alice-team' })
    expect(renamed.status).toBe(201)
    expect(mountAtWorkspace).toHaveBeenCalledWith(env, 'ws2', 'dir1', 'ak1', 'alice-team', true)
    expect(addAfsTeamMount).toHaveBeenCalledWith('share1', 'ws2', 'read_only', 'alice-team')
  })

  it('mounts again at the same name when the permission changes', async () => {
    vi.mocked(getAfsGrantCeiling).mockResolvedValue('read_write')
    vi.mocked(listAfsMountNames).mockResolvedValue(['alice-team'])
    vi.mocked(getAfsShareMember).mockResolvedValue({
      workspace_id: 'ws2',
      permission: 'read_only',
      source: 'team',
      mount_name: 'alice-team',
    } as never)

    const res = await mount('ws2', { share_id: 'share1', permission: 'read_write' })

    expect(res.status).toBe(201)
    expect(unmountAtWorkspace).toHaveBeenCalledWith(env, 'ws2', 'alice-team')
    expect(mountAtWorkspace).toHaveBeenCalledWith(env, 'ws2', 'dir1', 'ak1', 'alice-team', false)
  })

  it("refuses the user's own folder, which goes to their workspaces directly", async () => {
    vi.mocked(getAfsShareById).mockResolvedValue({ ...share, owner_workspace_id: 'ws3' } as never)

    const res = await mount('ws2', { share_id: 'share1' })

    expect(res.status).toBe(404)
    expect(getAfsGrantCeiling).not.toHaveBeenCalled()
  })

  it('refuses a workspace on another environment', async () => {
    vi.mocked(getAfsGrantCeiling).mockResolvedValue('read_only')
    vi.mocked(afsEnvForWorkspace).mockImplementation(
      async (id) => ({ environmentId: id === 'ws1' ? 'env1' : 'env2', isBuiltin: true }) as never,
    )

    const res = await mount('ws2', { share_id: 'share1' })

    expect(res.status).toBe(400)
    expect(addAfsTeamMount).not.toHaveBeenCalled()
  })
})

describe('members of a team-shared folder', () => {
  beforeEach(() => {
    vi.mocked(getWorkspace).mockImplementation(async (id) => (workspaces[id] ?? null) as never)
    vi.mocked(getAfsShareById).mockResolvedValue(share as never)
    vi.mocked(listAfsShareMemberDetails).mockResolvedValue([
      { workspace_id: 'ws1', user_id: 'alice', mount_name: 'team', mounted_at: new Date() },
      { workspace_id: 'ws2', user_id: 'bob', mount_name: 'alice-team', mounted_at: new Date() },
      { workspace_id: 'ws4', user_id: 'dave', mount_name: 'team', mounted_at: new Date() },
    ] as never)
  })

  it("shows another user's member only the members of its own owner", async () => {
    const res = await teamApp('bob').request('/ws2/afs/shares/share1/members')

    expect(res.status).toBe(200)
    const body = (await res.json()) as { members: { workspace_id: string }[] }
    expect(body.members.map((m) => m.workspace_id)).toEqual(['ws2'])
  })

  it('shows the owner every member', async () => {
    const res = await teamApp('alice').request('/ws1/afs/shares/share1/members')

    const body = (await res.json()) as { members: { workspace_id: string }[] }
    expect(body.members.map((m) => m.workspace_id)).toEqual(['ws1', 'ws2', 'ws4'])
  })

  it('unmounts a member that leaves at its own mount name', async () => {
    vi.mocked(removeAfsShareMember).mockResolvedValue('alice-team')

    const res = await teamApp('bob').request('/ws2/afs/shares/share1/members/ws2', json('DELETE'))

    expect(res.status).toBe(200)
    expect(unmountAtWorkspace).toHaveBeenCalledWith(env, 'ws2', 'alice-team')
  })
})
