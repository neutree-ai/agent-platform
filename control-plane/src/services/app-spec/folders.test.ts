import { describe, expect, it } from 'vitest'
import { planFolders, revokedFolders } from './folders'

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
