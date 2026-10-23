// The folders an application's spec declares (`shared_folders`). Each user
// gets one per folder: the user's workspace for the folder's owner agent owns
// it, and the user's workspaces for its member agents mount it too.
//
// A folder's owner can't change in place: the folder lives with its owner's
// workspace. A spec that gives a folder another owner, or drops it, revokes
// each user's copy with its contents, so it is applied only with `prune`.

import { type ResolvedFolder, canonicalJson } from './resolve'

export interface FolderPlanEntry {
  folder: string
  action: 'create' | 'update' | 'delete' | 'unchanged'
  /** For an update: what changes, `owner` and/or `members`. */
  changes?: string[]
}

/** How the folders change from the spec in force to the next one. */
export function planFolders(
  before: Record<string, ResolvedFolder>,
  after: Record<string, ResolvedFolder>,
): FolderPlanEntry[] {
  const entries: FolderPlanEntry[] = []
  for (const [name, folder] of Object.entries(after)) {
    const previous = before[name]
    if (!previous) {
      entries.push({ folder: name, action: 'create' })
      continue
    }
    const changes: string[] = []
    if (previous.owner !== folder.owner) changes.push('owner')
    if (canonicalJson(previous.members) !== canonicalJson(folder.members)) changes.push('members')
    entries.push(
      changes.length > 0
        ? { folder: name, action: 'update', changes }
        : { folder: name, action: 'unchanged' },
    )
  }
  for (const name of Object.keys(before)) {
    if (!after[name]) entries.push({ folder: name, action: 'delete' })
  }
  return entries.sort((a, b) => a.folder.localeCompare(b.folder))
}

/** The folders of a plan whose users' copies are revoked: dropped, or given another owner. */
export function revokedFolders(plan: FolderPlanEntry[]): string[] {
  return plan
    .filter((e) => e.action === 'delete' || e.changes?.includes('owner'))
    .map((e) => e.folder)
}
