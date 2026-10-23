// Shared folders: an afs directory one workspace owns, mounted at
// /mnt/afs/<name> in it and in every workspace it is granted to.
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
  createAfsShare,
  deleteAfsShare,
  getAfsShareByName,
  listAfsShareMembers,
  removeAfsShareMember,
} from './db/afs-shares'

/** The workspace is on another environment than the folder's owner, so it could never mount it. */
export class ShareEnvironmentError extends Error {}

interface MountOptions {
  /** Tell the workspace's pod to mount now, rather than when it next starts. */
  mountNow: boolean
}

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
  let ownerIsMember = false
  if (share) {
    const members = await listAfsShareMembers(share.id)
    ownerIsMember = members.some(
      (m) => m.workspace_id === ownerWorkspaceId && m.permission === 'read_write',
    )
  }
  if (share && ownerIsMember) return share

  const afsEnv = await afsEnvForWorkspace(ownerWorkspaceId)
  if (!share) {
    await ensureDefaultFs(afsEnv)
    const dir = await createDir(afsEnv)
    share = await createAfsShare(ownerWorkspaceId, name, dir.id, dir.accessKey)
  } else if (mountNow) {
    // The earlier attempt may have mounted before it failed, and
    // afs-fuse's Mount RPC rejects duplicate mountpoints.
    try {
      await unmountAtWorkspace(afsEnv, ownerWorkspaceId, name)
    } catch {
      // Best-effort — usually there is nothing mounted.
    }
  }
  if (mountNow) {
    await mountAtWorkspace(
      afsEnv,
      ownerWorkspaceId,
      share.afs_dir_id,
      share.access_key,
      name,
      false,
    )
  }
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
  // afs sharing scope is one environment: a share's dir + storage live in the
  // owner's environment, so a member on a different environment could never
  // mount it.
  const afsEnv = await afsEnvForWorkspace(share.owner_workspace_id)
  const targetEnv = await afsEnvForWorkspace(workspaceId)
  if (targetEnv.environmentId !== afsEnv.environmentId) {
    throw new ShareEnvironmentError('Target workspace is on a different environment')
  }

  if (mountNow) {
    // If the target is already a member, re-mount with the (possibly changed)
    // permission. afs-fuse's Mount RPC rejects duplicate mountpoints, so
    // we unmount first.
    const existing = await listAfsShareMembers(share.id)
    if (existing.some((m) => m.workspace_id === workspaceId)) {
      try {
        await unmountAtWorkspace(afsEnv, workspaceId, share.name)
      } catch {
        // Best-effort — continue even if stale unmount fails.
      }
    }
    await mountAtWorkspace(
      afsEnv,
      workspaceId,
      share.afs_dir_id,
      share.access_key,
      share.name,
      permission === 'read_only',
    )
  }
  await addAfsShareMember(share.id, workspaceId, permission)
}

/** Take the folder away from a member. False when it wasn't one. */
export async function removeShareMember(share: AfsShare, workspaceId: string): Promise<boolean> {
  const removed = await removeAfsShareMember(share.id, workspaceId)
  if (removed) {
    try {
      await unmountAtWorkspace(await afsEnvForWorkspace(workspaceId), workspaceId, share.name)
    } catch {
      // Best-effort: a pod that isn't running has nothing mounted, and won't
      // mount it again now that the membership is gone.
    }
  }
  return removed
}

/** Revoke the folder: its directory is destroyed and every member unmounted. */
export async function revokeShare(share: AfsShare): Promise<void> {
  const afsEnv = await afsEnvForWorkspace(share.owner_workspace_id)
  const members = await listAfsShareMembers(share.id)
  try {
    await revokeDir(afsEnv, share.afs_dir_id, share.access_key)
  } catch {
    // Best-effort: still clean up DB + local mounts below.
  }
  for (const m of members) {
    try {
      await unmountAtWorkspace(afsEnv, m.workspace_id, share.name)
    } catch {
      // Mount may already be gone after revoke.
    }
  }
  await deleteAfsShare(share.id)
}
