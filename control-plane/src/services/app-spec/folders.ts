// The folders an application's spec declares (`shared_folders`). Each user
// gets one per folder: the user's workspace for the folder's owner agent owns
// it, and the user's workspaces for its member agents mount it too.
//
// A folder's owner can't change in place: the folder lives with its owner's
// workspace. A spec that gives a folder another owner, or drops it, revokes
// each user's copy with its contents, so it is applied only with `prune`.
//
// A user's folders are brought in line whenever one of the user's agent
// workspaces is ensured, and by the sweep. The owner's and the members'
// workspaces are created whenever the application asks for them, in any
// order, so each pass does what the workspaces that exist allow: a folder is
// made once its owner's workspace exists, and a member is added once its
// workspace exists. A member's workspace whose pod is running mounts the
// folder right away; any other mounts it from its membership when its pod
// next starts.

import {
  ShareEnvironmentError,
  ensureShare,
  grantShare,
  removeShareMember,
  revokeShare,
} from '../afs-shares'
import type { AfsPermission, AfsShare } from '../db/afs-shares'
import { pool } from '../db/pool'
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

// ── Bringing a user's folders in line ──────────────────────────────────────

interface UserWorkspace {
  agent: string
  workspace_id: string
  status: string
  folders_blocked: string | null
}

interface ExistingShare {
  share: AfsShare
  /** Made for the spec, rather than by an agent or by hand. */
  tracked: boolean
  /** Member workspace → permission, the owner's included. */
  members: Record<string, AfsPermission>
}

/** What one user's folders are and should be. */
export interface UserFolders {
  client_id: string
  user_id: string
  /** The folders of the spec in force. */
  folders: Record<string, ResolvedFolder>
  /** The user's agent workspaces. */
  workspaces: UserWorkspace[]
  /** Shares owned by those workspaces: the ones made for the spec, and any named like a folder. */
  shares: ExistingShare[]
}

type FolderStep =
  /** Make the folder, or finish one; afterwards the owner is a read-write member. */
  | { kind: 'create'; folder: string; owner_workspace_id: string }
  /**
   * A member's change, on the share found for the folder, or (null) on the one
   * the folder's create step makes.
   */
  | {
      kind: 'grant'
      folder: string
      share: AfsShare | null
      workspace_id: string
      permission: AfsPermission
    }
  | { kind: 'remove'; folder: string; share: AfsShare | null; workspace_id: string }
  /** A share made for a folder the spec no longer gives that owner. */
  | { kind: 'revoke'; folder: string; share: AfsShare }

/**
 * What it takes to bring the user's folders in line with the spec, given the
 * workspaces the user has. Empty when they are. Revokes come first, so a
 * folder that moves to another owner is unmounted before it is mounted again
 * under the same name.
 */
export function planUserFolders(state: UserFolders): FolderStep[] {
  const byAgent = new Map(state.workspaces.map((w) => [w.agent, w]))
  const revokes: FolderStep[] = []
  const steps: FolderStep[] = []
  const kept = new Set<string>()

  for (const [name, folder] of Object.entries(state.folders).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    // Made once the owner's workspace exists.
    const owner = byAgent.get(folder.owner)
    if (!owner) continue

    const existing = state.shares.find(
      (s) => s.share.owner_workspace_id === owner.workspace_id && s.share.name === name,
    )
    if (existing) kept.add(existing.share.id)
    const share = existing?.share ?? null
    const actual = existing?.members ?? {}

    // A share by that name the owner made itself is taken over, as creating
    // it again by name would. One whose owner isn't a read-write member is
    // half made, or was changed by hand.
    if (!existing || !existing.tracked || actual[owner.workspace_id] !== 'read_write') {
      steps.push({ kind: 'create', folder: name, owner_workspace_id: owner.workspace_id })
    }

    // Members whose workspaces exist yet; the rest are added when they do.
    const desired: Record<string, AfsPermission> = {}
    for (const [agent, permission] of Object.entries(folder.members).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      const member = byAgent.get(agent)
      if (member) desired[member.workspace_id] = permission
    }
    for (const [workspaceId, permission] of Object.entries(desired)) {
      if (actual[workspaceId] !== permission) {
        steps.push({ kind: 'grant', folder: name, share, workspace_id: workspaceId, permission })
      }
    }
    // The spec says who the members are: a workspace it doesn't list loses
    // the folder, whether the spec stopped listing its agent or the folder
    // was granted to it some other way.
    for (const workspaceId of Object.keys(actual).sort()) {
      if (workspaceId !== owner.workspace_id && !(workspaceId in desired)) {
        steps.push({ kind: 'remove', folder: name, share, workspace_id: workspaceId })
      }
    }
  }

  for (const existing of state.shares) {
    if (existing.tracked && !kept.has(existing.share.id)) {
      revokes.push({ kind: 'revoke', folder: existing.share.name, share: existing.share })
    }
  }
  return [...revokes, ...steps]
}

/**
 * Take the steps, each on its own: one that fails doesn't stop the others,
 * and is told in the blocked reason of the workspace it is about. Returns
 * those reasons by workspace.
 */
async function takeSteps(state: UserFolders, steps: FolderStep[]): Promise<Map<string, string[]>> {
  const statusOf = new Map(state.workspaces.map((w) => [w.workspace_id, w.status]))
  const appWorkspaces = new Set(state.workspaces.map((w) => w.workspace_id))
  // Shares made by the create steps below, by folder, and the folders whose
  // create failed: their members wait for it.
  const made = new Map<string, AfsShare>()
  const notMade = new Set<string>()

  const problems = new Map<string, string[]>()
  const report = (workspaceId: string, folder: string, error: unknown) => {
    const reasons = problems.get(workspaceId) ?? []
    reasons.push(`shared folder ${folder}: ${(error as Error).message}`)
    problems.set(workspaceId, reasons)
  }

  for (const step of steps) {
    if (step.kind === 'revoke') {
      try {
        await revokeShare(step.share)
      } catch (e) {
        report(step.share.owner_workspace_id, step.folder, e)
      }
      continue
    }

    if (step.kind === 'create') {
      try {
        const share = await ensureShare(step.owner_workspace_id, step.folder, {
          mountNow: statusOf.get(step.owner_workspace_id) === 'running',
        })
        await pool.query(
          'INSERT INTO app_shared_folders (share_id) VALUES ($1) ON CONFLICT (share_id) DO NOTHING',
          [share.id],
        )
        made.set(step.folder, share)
      } catch (e) {
        // Its members wait for it; the owner's reason says why.
        notMade.add(step.folder)
        report(step.owner_workspace_id, step.folder, e)
      }
      continue
    }

    if (notMade.has(step.folder)) continue
    const share = made.get(step.folder) ?? step.share
    if (!share) continue

    if (step.kind === 'grant') {
      try {
        await grantShare(share, step.workspace_id, step.permission, {
          mountNow: statusOf.get(step.workspace_id) === 'running',
        })
      } catch (e) {
        const error =
          e instanceof ShareEnvironmentError
            ? new Error("the workspace is on another environment than the folder's owner")
            : e
        report(step.workspace_id, step.folder, error)
      }
      continue
    }

    try {
      await removeShareMember(share, step.workspace_id)
    } catch (e) {
      // A member outside the application has no status to show it in.
      report(
        appWorkspaces.has(step.workspace_id) ? step.workspace_id : share.owner_workspace_id,
        step.folder,
        e,
      )
    }
  }
  return problems
}

/** Record each workspace's reason, said once when it changes. */
async function recordProblems(state: UserFolders, problems: Map<string, string[]>) {
  for (const workspace of state.workspaces) {
    const reason = problems.get(workspace.workspace_id)?.join('; ') ?? null
    if (reason === workspace.folders_blocked) continue
    if (reason) {
      console.error(
        `[app-spec] workspace ${workspace.workspace_id} can't have its shared folders: ${reason}`,
      )
    }
    await pool.query('UPDATE app_workspaces SET folders_blocked = $2 WHERE workspace_id = $1', [
      workspace.workspace_id,
      reason,
    ])
  }
}

interface ShareRow extends AfsShare {
  client_id: string
  user_id: string
  tracked: boolean
  members: Record<string, AfsPermission>
}

/**
 * What the folders of the application's users (of all applications without
 * `clientId`; of one user with `userId`) are and should be. Three queries,
 * whatever the number of users: only applications whose spec declares
 * folders, or that have folders left to revoke, are looked at.
 */
async function loadUserFolders(clientId?: string, userId?: string): Promise<UserFolders[]> {
  // Each application's spec in force only: its latest version, read through
  // the (client_id, version) key rather than every version it has had.
  const { rows: specs } = await pool.query(
    `SELECT c.id AS client_id, s.folders
       FROM oauth_clients c
       CROSS JOIN LATERAL (
         SELECT resolved->'shared_folders' AS folders FROM app_specs
          WHERE client_id = c.id ORDER BY version DESC LIMIT 1) s
      WHERE ($1::text IS NULL OR c.id = $1)`,
    [clientId ?? null],
  )
  const foldersOf = new Map<string, Record<string, ResolvedFolder>>()
  for (const row of specs as {
    client_id: string
    folders: Record<string, ResolvedFolder> | null
  }[]) {
    if (row.folders) foldersOf.set(row.client_id, row.folders)
  }
  // A folder's application is its owner workspace's.
  const { rows: withFolders } = await pool.query(
    `SELECT DISTINCT aw.client_id
       FROM app_shared_folders f
       JOIN afs_shares s ON s.id = f.share_id
       JOIN app_workspaces aw ON aw.workspace_id = s.owner_workspace_id
      WHERE ($1::text IS NULL OR aw.client_id = $1)`,
    [clientId ?? null],
  )
  const clients = new Set([...foldersOf.keys(), ...withFolders.map((r) => r.client_id as string)])
  if (clients.size === 0) return []

  const { rows: workspaces } = await pool.query(
    `SELECT aw.client_id, aw.user_id, aw.agent, aw.workspace_id, w.status, aw.folders_blocked
       FROM app_workspaces aw
       JOIN workspaces w ON w.id = aw.workspace_id
      WHERE aw.client_id = ANY($1) AND ($2::text IS NULL OR aw.user_id = $2)`,
    [[...clients], userId ?? null],
  )
  const names = [...new Set([...foldersOf.values()].flatMap((f) => Object.keys(f)))]
  const { rows: shares } = await pool.query(
    `SELECT s.*, aw.client_id, aw.user_id, (f.share_id IS NOT NULL) AS tracked,
            COALESCE(json_object_agg(m.workspace_id, m.permission)
                       FILTER (WHERE m.workspace_id IS NOT NULL), '{}') AS members
       FROM afs_shares s
       JOIN app_workspaces aw ON aw.workspace_id = s.owner_workspace_id
       LEFT JOIN app_shared_folders f ON f.share_id = s.id
       LEFT JOIN afs_share_members m ON m.share_id = s.id
      WHERE aw.client_id = ANY($1) AND ($2::text IS NULL OR aw.user_id = $2)
        AND (f.share_id IS NOT NULL OR s.name = ANY($3))
      GROUP BY s.id, aw.client_id, aw.user_id, f.share_id`,
    [[...clients], userId ?? null, names],
  )

  const users = new Map<string, UserFolders>()
  for (const w of workspaces as (UserWorkspace & { client_id: string; user_id: string })[]) {
    const key = `${w.client_id}:${w.user_id}`
    let user = users.get(key)
    if (!user) {
      user = {
        client_id: w.client_id,
        user_id: w.user_id,
        folders: foldersOf.get(w.client_id) ?? {},
        workspaces: [],
        shares: [],
      }
      users.set(key, user)
    }
    user.workspaces.push({
      agent: w.agent,
      workspace_id: w.workspace_id,
      status: w.status,
      folders_blocked: w.folders_blocked,
    })
  }
  for (const row of shares as ShareRow[]) {
    const { client_id, user_id, tracked, members, ...share } = row
    users.get(`${client_id}:${user_id}`)?.shares.push({ share, tracked, members })
  }
  return [...users.values()]
}

/** Nothing to do, and nothing left blocked from an earlier pass. */
function inLine(state: UserFolders): boolean {
  return (
    planUserFolders(state).length === 0 && state.workspaces.every((w) => w.folders_blocked === null)
  )
}

/**
 * Bring the user's folders in line with the spec, waiting for a pass already
 * running for the user. Runs one at a time per user, across control-plane
 * replicas.
 */
export async function bringUserFoldersInLine(clientId: string, userId: string): Promise<void> {
  // Read without the lock first: most of the time there's nothing to do.
  const [before] = await loadUserFolders(clientId, userId)
  if (!before || inLine(before)) return
  await underUserLock(clientId, userId, { wait: true })
}

/**
 * Take the user's steps under the user's lock: with `wait`, after the pass
 * running; without, not at all while one is running, since that one does the
 * work.
 */
async function underUserLock(
  clientId: string,
  userId: string,
  { wait }: { wait: boolean },
): Promise<void> {
  const lock = await pool.connect()
  const key = `app-folders:${clientId}:${userId}`
  let locked = false
  try {
    if (wait) {
      await lock.query('SELECT pg_advisory_lock(hashtext($1))', [key])
      locked = true
    } else {
      const { rows } = await lock.query('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [key])
      locked = rows[0].ok
      if (!locked) return
    }
    // Again under the lock, since another pass may have just done the work.
    const [state] = await loadUserFolders(clientId, userId)
    if (!state) return
    const problems = await takeSteps(state, planUserFolders(state))
    await recordProblems(state, problems)
  } finally {
    if (locked) await lock.query('SELECT pg_advisory_unlock(hashtext($1))', [key])
    lock.release()
  }
}

/** Bring every user's folders in line (one application's, with `clientId`). */
export async function convergeAppFolders(clientId?: string): Promise<void> {
  // Every user is read once here; one out of line is read again under its lock.
  for (const state of await loadUserFolders(clientId)) {
    if (inLine(state)) continue
    try {
      await underUserLock(state.client_id, state.user_id, { wait: false })
    } catch (e) {
      console.error(`[app-spec] shared folders of user ${state.user_id} failed:`, e)
    }
  }
}
