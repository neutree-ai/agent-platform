import { describe, expect, it } from 'vitest'
import { type UserFolders, planFolders, planUserFolders, revokedFolders } from './folders'

describe('planFolders', () => {
  it('says which folders are created, changed, kept and dropped', () => {
    const before = {
      kept: { owner: 'main', members: { diver: 'read_only' as const } },
      shared: { owner: 'main', members: { diver: 'read_only' as const } },
      moved: { owner: 'main', members: {} },
      dropped: { owner: 'main', members: {} },
    }
    const after = {
      kept: { owner: 'main', members: { diver: 'read_only' as const } },
      shared: { owner: 'main', members: { diver: 'read_write' as const } },
      moved: { owner: 'diver', members: { main: 'read_only' as const } },
      added: { owner: 'diver', members: {} },
    }

    const plan = planFolders(before, after)

    expect(plan).toEqual([
      { folder: 'added', action: 'create' },
      { folder: 'dropped', action: 'delete' },
      { folder: 'kept', action: 'unchanged' },
      { folder: 'moved', action: 'update', changes: ['owner', 'members'] },
      { folder: 'shared', action: 'update', changes: ['members'] },
    ])
    // Only dropping a folder or moving it to another owner loses its contents.
    expect(revokedFolders(plan)).toEqual(['dropped', 'moved'])
  })
})

describe('planUserFolders', () => {
  const workspace = (agent: string, status = 'running') => ({
    agent,
    workspace_id: `ws-${agent}`,
    status,
    folders_blocked: null,
  })
  const share = (name: string, owner: string, id = `share-${name}`) => ({
    id,
    owner_workspace_id: `ws-${owner}`,
    name,
    afs_dir_id: `dir-${id}`,
    access_key: `key-${id}`,
    created_at: new Date('2026-10-01T00:00:00Z'),
  })
  const folders = {
    notes: {
      owner: 'main',
      members: { diver: 'read_write' as const, scout: 'read_only' as const },
    },
  }
  const state = (overrides: Partial<UserFolders>): UserFolders => ({
    client_id: 'app',
    user_id: 'alice',
    folders,
    workspaces: [],
    shares: [],
    ...overrides,
  })

  it('waits for the owner workspace, whatever members exist', () => {
    expect(planUserFolders(state({ workspaces: [workspace('diver')] }))).toEqual([])
  })

  it('makes the folder once the owner workspace exists, with the members that exist', () => {
    const plan = planUserFolders(state({ workspaces: [workspace('main'), workspace('scout')] }))

    expect(plan).toEqual([
      { kind: 'create', folder: 'notes', owner_workspace_id: 'ws-main' },
      {
        kind: 'grant',
        folder: 'notes',
        share: null,
        workspace_id: 'ws-scout',
        permission: 'read_only',
      },
    ])
  })

  it('adds a member whose workspace came after the folder', () => {
    const plan = planUserFolders(
      state({
        workspaces: [workspace('main'), workspace('scout'), workspace('diver', 'stopped')],
        shares: [
          {
            share: share('notes', 'main'),
            tracked: true,
            members: { 'ws-main': 'read_write', 'ws-scout': 'read_only' },
          },
        ],
      }),
    )

    expect(plan).toEqual([
      {
        kind: 'grant',
        folder: 'notes',
        share: share('notes', 'main'),
        workspace_id: 'ws-diver',
        permission: 'read_write',
      },
    ])
  })

  it('has nothing to do when the folder is in line', () => {
    const plan = planUserFolders(
      state({
        workspaces: [workspace('main'), workspace('scout'), workspace('diver')],
        shares: [
          {
            share: share('notes', 'main'),
            tracked: true,
            members: { 'ws-main': 'read_write', 'ws-scout': 'read_only', 'ws-diver': 'read_write' },
          },
        ],
      }),
    )

    expect(plan).toEqual([])
  })

  it('changes permissions and removes members the spec does not list', () => {
    const plan = planUserFolders(
      state({
        folders: { notes: { owner: 'main', members: { scout: 'read_write' } } },
        workspaces: [workspace('main'), workspace('scout'), workspace('diver')],
        shares: [
          {
            share: share('notes', 'main'),
            tracked: true,
            members: {
              'ws-main': 'read_write',
              'ws-scout': 'read_only',
              'ws-diver': 'read_write',
              // Granted by hand to a workspace outside the application.
              'ws-other': 'read_only',
            },
          },
        ],
      }),
    )

    expect(plan).toEqual([
      {
        kind: 'grant',
        folder: 'notes',
        share: share('notes', 'main'),
        workspace_id: 'ws-scout',
        permission: 'read_write',
      },
      { kind: 'remove', folder: 'notes', share: share('notes', 'main'), workspace_id: 'ws-diver' },
      { kind: 'remove', folder: 'notes', share: share('notes', 'main'), workspace_id: 'ws-other' },
    ])
  })

  it('finishes a folder whose owner is not a read-write member', () => {
    const halfMade = { share: share('notes', 'main'), tracked: true, members: {} }
    const readOnly = { ...halfMade, members: { 'ws-main': 'read_only' as const } }
    const solo = { notes: { owner: 'main', members: {} } }

    for (const existing of [halfMade, readOnly]) {
      expect(
        planUserFolders(
          state({ folders: solo, workspaces: [workspace('main')], shares: [existing] }),
        ),
      ).toEqual([{ kind: 'create', folder: 'notes', owner_workspace_id: 'ws-main' }])
    }
  })

  it("takes over the owner's own share by that name, and leaves other workspaces' alone", () => {
    const solo = { notes: { owner: 'main', members: {} } }
    const plan = planUserFolders(
      state({
        folders: solo,
        workspaces: [workspace('main'), workspace('diver')],
        shares: [
          { share: share('notes', 'main'), tracked: false, members: { 'ws-main': 'read_write' } },
          {
            share: share('notes', 'diver', 'diver-notes'),
            tracked: false,
            members: { 'ws-diver': 'read_write' },
          },
        ],
      }),
    )

    expect(plan).toEqual([{ kind: 'create', folder: 'notes', owner_workspace_id: 'ws-main' }])
  })

  it('revokes folders the spec drops or moves to another owner, before anything else', () => {
    const notes = share('notes', 'main')
    const logs = share('logs', 'main')
    const plan = planUserFolders(
      state({
        folders: { notes: { owner: 'diver', members: { main: 'read_only' } } },
        workspaces: [workspace('main'), workspace('diver')],
        shares: [
          {
            share: notes,
            tracked: true,
            members: { 'ws-main': 'read_write', 'ws-diver': 'read_only' },
          },
          { share: logs, tracked: true, members: { 'ws-main': 'read_write' } },
        ],
      }),
    )

    expect(plan).toEqual([
      { kind: 'revoke', folder: 'notes', share: notes },
      { kind: 'revoke', folder: 'logs', share: logs },
      { kind: 'create', folder: 'notes', owner_workspace_id: 'ws-diver' },
      {
        kind: 'grant',
        folder: 'notes',
        share: null,
        workspace_id: 'ws-main',
        permission: 'read_only',
      },
    ])
  })
})
