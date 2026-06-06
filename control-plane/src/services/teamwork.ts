import { createDir, ensureDefaultFs, mountAtWorkspace, revokeDir, unmountAtWorkspace } from './afs'
import {
  addAfsShareMember,
  createAfsShare,
  deleteAfsShare,
  getAfsShareById,
  removeAfsShareMember,
} from './db/afs-shares'
import { type TeamworkTask, updateTeamworkTask } from './db/teamwork'

/**
 * Mount path inside every participating workspace. The bare share `name`
 * (without the `/mnt/afs/` prefix) is also what `afs_shares.name` stores —
 * unique per owner_workspace, fits the platform's name regex.
 */
function teamworkShareName(taskId: string): string {
  return `team-${taskId}`
}

/**
 * Allocate an AFS dir for the task, persist the share row, and mount it on
 * the coordinator. The task row is updated in-place with `afs_share_id`.
 */
export async function provisionTeamworkShare(task: TeamworkTask): Promise<string> {
  await ensureDefaultFs()
  const dir = await createDir()
  const name = teamworkShareName(task.id)
  const share = await createAfsShare(task.coordinator_workspace_id, name, dir.id, dir.accessKey)
  await mountAtWorkspace(task.coordinator_workspace_id, dir.id, dir.accessKey, name, false)
  await addAfsShareMember(share.id, task.coordinator_workspace_id, 'read_write')
  await updateTeamworkTask(task.id, { afs_share_id: share.id })
  return share.id
}

/** Mount the task's share on a roster member's workspace. Read-write — */
/** members co-edit the shared scratch space. */
export async function mountTeamworkShareForMember(
  shareId: string,
  taskId: string,
  workspaceId: string,
): Promise<void> {
  const share = await getAfsShareById(shareId)
  if (!share) throw new Error(`Teamwork share ${shareId} not found`)
  await mountAtWorkspace(
    workspaceId,
    share.afs_dir_id,
    share.access_key,
    teamworkShareName(taskId),
    false,
  )
  await addAfsShareMember(share.id, workspaceId, 'read_write')
}

/** Reverse of mount. Best-effort — unmount errors don't roll back DB. */
export async function unmountTeamworkShareForMember(
  shareId: string,
  taskId: string,
  workspaceId: string,
): Promise<void> {
  await removeAfsShareMember(shareId, workspaceId)
  try {
    await unmountAtWorkspace(workspaceId, teamworkShareName(taskId))
  } catch {
    // Mount may already be gone (workspace stopped, manual unmount, etc.).
    // Membership row removal above is the source of truth.
  }
}

/**
 * Tear down the share completely: revoke the dir (force-unmounts all members
 * server-side), delete the share row. Used when a task is deleted.
 */
export async function teardownTeamworkShare(shareId: string): Promise<void> {
  const share = await getAfsShareById(shareId)
  if (!share) return
  try {
    await revokeDir(share.afs_dir_id, share.access_key)
  } catch {
    // Even if the controller errors, drop the DB row so we don't leak it.
  }
  await deleteAfsShare(share.id)
}
