// Shared folders: an afs directory one workspace owns, mounted at
// /mnt/afs/<name> in it and in every workspace it is granted to.
//
// The owner grants a folder to its own other workspaces directly. Other users
// get it through teams: the owner grants it to a team they are in, and a
// member of that team mounts it in a workspace of theirs, at up to the grant's
// permission. A team mount lasts while a grant to one of the workspace owner's
// teams allows it; reconcileTeamMounts takes away what no longer is.
//
// A folder's membership rows are what a workspace's afs sidecar mounts when its
// pod starts. A pod that is already running doesn't look again, so a grant
// that should take effect now tells it to mount: that's `mountNow`. Without
// it, only the membership is recorded, and the pod mounts the folder when it
// next starts.

import {
  afsEnvForWorkspace,
  createDir,
  ensureDefaultFs,
  mountAtWorkspace,
  revokeDir,
  unmountAtWorkspace,
} from './afs'
import {
  type AfsPermission,
  type AfsShare,
  addAfsShareMember,
  addAfsTeamMount,
  createAfsShare,
  deleteAfsShare,
  deleteAfsShareGrant,
  getAfsGrantCeiling,
  getAfsShareByName,
  getAfsShareMember,
  listAfsMountNames,
  listAfsShareMembers,
  listAfsSharesOwnedBy,
  listAfsTeamMountsOutOfLine,
  removeAfsShareMember,
  setAfsMemberPermission,
  upsertAfsShareGrant,
} from './db/afs-shares'
import { getTeamMembership } from './db/teams'
import type { Workspace } from './db/types'

/** The workspace is on another environment than the folder's owner, so it could never mount it. */
export class ShareEnvironmentError extends Error {}

/** No grant lets the workspace's owner have the folder, or not at that permission. */
export class ShareAccessError extends Error {}

/** The workspace already has a folder mounted at that name. */
export class ShareNameConflictError extends Error {}

const PERMISSION_RANK: Record<AfsPermission, number> = { read_only: 0, read_write: 1 }

interface MountOptions {
  /** Tell the workspace's pod to mount now, rather than when it next starts. */
  mountNow: boolean
}

type AfsEnv = Awaited<ReturnType<typeof afsEnvForWorkspace>>

/**
 * Unmount the folder at `name`, where there may be nothing mounted: a pod that
 * isn't running has nothing, and mounts what its memberships say when it starts.
 */
export async function unmountQuietly(
  afsEnv: AfsEnv,
  workspaceId: string,
  name: string,
): Promise<void> {
  try {
    await unmountAtWorkspace(afsEnv, workspaceId, name)
  } catch {
    // Nothing was mounted there.
  }
}

/**
 * Mount the folder at `name`, unmounting what is at `previous` first:
 * afs-fuse's Mount RPC rejects a mountpoint already in use.
 */
async function remount(
  afsEnv: AfsEnv,
  workspaceId: string,
  share: AfsShare,
  name: string,
  readonly: boolean,
  previous: string | undefined,
): Promise<void> {
  if (previous) await unmountQuietly(afsEnv, workspaceId, previous)
  await mountAtWorkspace(afsEnv, workspaceId, share.afs_dir_id, share.access_key, name, readonly)
}

/**
 * The environment the folder lives in, which the workspace must be on too: a
 * share's dir and storage live in the owner's environment, so a member on
 * another could never mount it.
 */
async function sharingEnv(share: AfsShare, workspaceId: string): Promise<AfsEnv> {
  const [afsEnv, targetEnv] = await Promise.all([
    afsEnvForWorkspace(share.owner_workspace_id),
    afsEnvForWorkspace(workspaceId),
  ])
  if (targetEnv.environmentId !== afsEnv.environmentId) {
    throw new ShareEnvironmentError('Target workspace is on a different environment')
  }
  return afsEnv
}

const nameTaken = (name: string) =>
  new ShareNameConflictError(`A folder is already mounted at /mnt/afs/${name}`)

/**
 * The owner's folder by that name, created when it has none. Idempotent on
 * the name. Afterwards the owner is a read-write member of it.
 */
export async function ensureShare(
  ownerWorkspaceId: string,
  name: string,
  { mountNow }: MountOptions,
): Promise<AfsShare> {
  let share = await getAfsShareByName(ownerWorkspaceId, name)
  // Creating a share takes three writes: the record, the owner's mount, and
  // the owner's membership. A request that failed after the first leaves a
  // record with no mount behind it, so an existing record is only complete
  // once the owner is a read-write member; until then a retry picks up where
  // it stopped.
  if (share && (await getAfsShareMember(share.id, ownerWorkspaceId))?.permission === 'read_write') {
    return share
  }

  const afsEnv = await afsEnvForWorkspace(ownerWorkspaceId)
  // The earlier attempt may have mounted before it failed.
  let previous: string | undefined = name
  if (!share) {
    // A team mount may already be there under the name.
    if ((await listAfsMountNames(ownerWorkspaceId)).includes(name)) throw nameTaken(name)
    await ensureDefaultFs(afsEnv)
    const dir = await createDir(afsEnv)
    share = await createAfsShare(ownerWorkspaceId, name, dir.id, dir.accessKey)
    previous = undefined
  }
  if (mountNow) await remount(afsEnv, ownerWorkspaceId, share, name, false, previous)
  await addAfsShareMember(share.id, ownerWorkspaceId, 'read_write')
  return share
}

/**
 * Make the workspace a member of the folder at the permission, or change the
 * permission of one that is. Throws ShareEnvironmentError when the workspace
 * is on another environment than the owner.
 */
export async function grantShare(
  share: AfsShare,
  workspaceId: string,
  permission: AfsPermission,
  { mountNow }: MountOptions,
): Promise<void> {
  const afsEnv = await sharingEnv(share, workspaceId)
  if (mountNow) {
    // A member is mounted again with the (possibly changed) permission.
    const existing = await getAfsShareMember(share.id, workspaceId)
    await remount(
      afsEnv,
      workspaceId,
      share,
      share.name,
      permission === 'read_only',
      existing?.mount_name,
    )
  }
  await addAfsShareMember(share.id, workspaceId, permission)
}

/** Take the folder away from a member. False when it wasn't one. */
export async function removeShareMember(share: AfsShare, workspaceId: string): Promise<boolean> {
  const mountName = await removeAfsShareMember(share.id, workspaceId)
  if (mountName) {
    await unmountQuietly(await afsEnvForWorkspace(workspaceId), workspaceId, mountName)
  }
  return mountName !== null
}

/**
 * Revoke the folder: its directory is destroyed and every member unmounted.
 * Returns how many members it had.
 */
export async function revokeShare(share: AfsShare): Promise<number> {
  const afsEnv = await afsEnvForWorkspace(share.owner_workspace_id)
  const members = await listAfsShareMembers(share.id)
  try {
    await revokeDir(afsEnv, share.afs_dir_id, share.access_key)
  } catch {
    // Best-effort: still clean up DB + local mounts below.
  }
  for (const m of members) await unmountQuietly(afsEnv, m.workspace_id, m.mount_name)
  await deleteAfsShare(share.id)
  return members.length
}

/** Revoke every folder the workspace owns. Called before the workspace is deleted. */
export async function revokeSharesOwnedBy(workspaceId: string): Promise<void> {
  for (const share of await listAfsSharesOwnedBy(workspaceId)) {
    try {
      await revokeShare(share)
    } catch (e) {
      console.error(`[afs] revoke share ${share.id} of ws=${workspaceId} failed:`, e)
    }
  }
}

// ── Team grants ─────────────────────────────────────────────────────────────

/**
 * Grant the folder to a team, or change the grant's permission. The owner,
 * `userId`, must be in the team. Lowering a grant takes effect on the mounts
 * it allowed.
 */
export async function grantShareToTeam(
  share: AfsShare,
  teamId: string,
  permission: AfsPermission,
  userId: string,
): Promise<void> {
  if (!(await getTeamMembership(teamId, userId))) {
    throw new ShareAccessError('You can only share with a team you are in')
  }
  await upsertAfsShareGrant(share.id, teamId, permission, userId)
  await reconcileTeamMounts(share.id)
}

/** Take the folder's grant from a team, and the mounts only it allowed. */
export async function revokeShareFromTeam(share: AfsShare, teamId: string): Promise<boolean> {
  const removed = await deleteAfsShareGrant(share.id, teamId)
  if (removed) await reconcileTeamMounts(share.id)
  return removed
}

/**
 * Mount another user's folder in the workspace through a grant to one of the
 * workspace owner's teams, or change the permission of such a mount. A running
 * workspace mounts it now; any other when it starts. Throws ShareAccessError
 * when no grant allows it at that permission, ShareEnvironmentError when the
 * workspace is on another environment, and ShareNameConflictError when the
 * workspace has a folder at that name.
 */
export async function mountShareForTeam(
  share: AfsShare,
  workspace: Workspace,
  permission: AfsPermission,
  mountName: string | undefined,
): Promise<{ mount_name: string }> {
  const [ceiling, afsEnv] = await Promise.all([
    getAfsGrantCeiling(share.id, workspace.user_id),
    sharingEnv(share, workspace.id),
  ])
  if (!ceiling) throw new ShareAccessError('The folder is not shared with any of your teams')
  if (PERMISSION_RANK[permission] > PERMISSION_RANK[ceiling]) {
    throw new ShareAccessError('The folder is shared with your teams read-only')
  }

  const [existing, taken] = await Promise.all([
    getAfsShareMember(share.id, workspace.id),
    listAfsMountNames(workspace.id),
  ])
  if (existing && existing.source !== 'team') {
    throw new ShareAccessError('The workspace already has this folder')
  }
  const current = existing?.mount_name
  const name = mountName ?? current ?? share.name
  if (name !== current && taken.includes(name)) throw nameTaken(name)

  if (workspace.status === 'running') {
    await remount(afsEnv, workspace.id, share, name, permission === 'read_only', current)
  }
  await addAfsTeamMount(share.id, workspace.id, permission, name)
  return { mount_name: name }
}

/**
 * Bring the team mounts (of `shareId` only, when given) in line with the
 * grants: one no grant allows any more is unmounted and removed, and a
 * read-write one only read-only grants allow is mounted again read-only.
 * Called whenever grants or team memberships change. Each mount is handled on
 * its own; one that fails is logged.
 */
export async function reconcileTeamMounts(shareId?: string): Promise<void> {
  for (const m of await listAfsTeamMountsOutOfLine(shareId)) {
    try {
      const afsEnv = await afsEnvForWorkspace(m.workspace_id)
      if (!m.ceiling) {
        await removeAfsShareMember(m.share.id, m.workspace_id)
        await unmountQuietly(afsEnv, m.workspace_id, m.mount_name)
        continue
      }
      await setAfsMemberPermission(m.share.id, m.workspace_id, m.ceiling)
      // A stopped pod mounts it read-only when it starts.
      await remount(afsEnv, m.workspace_id, m.share, m.mount_name, true, m.mount_name).catch(
        () => {},
      )
    } catch (e) {
      console.error(
        `[afs] reconcile team mount share=${m.share.id} ws=${m.workspace_id} failed:`,
        e,
      )
    }
  }
}
