import { generateId, pool } from './pool'

interface AfsShare {
  id: string
  owner_workspace_id: string
  name: string
  afs_dir_id: string
  access_key: string
  created_at: Date
}

type AfsPermission = 'read_only' | 'read_write'

interface AfsShareMember {
  share_id: string
  workspace_id: string
  permission: AfsPermission
  mounted_at: Date
}

export async function createAfsShare(
  ownerWorkspaceId: string,
  name: string,
  afsDirId: string,
  accessKey: string,
): Promise<AfsShare> {
  const id = generateId()
  await pool.query(
    `INSERT INTO afs_shares (id, owner_workspace_id, name, afs_dir_id, access_key)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, ownerWorkspaceId, name, afsDirId, accessKey],
  )
  return (await getAfsShareByName(ownerWorkspaceId, name))!
}

export async function getAfsShareByName(
  ownerWorkspaceId: string,
  name: string,
): Promise<AfsShare | null> {
  const { rows } = await pool.query(
    'SELECT * FROM afs_shares WHERE owner_workspace_id = $1 AND name = $2',
    [ownerWorkspaceId, name],
  )
  return (rows[0] as AfsShare) ?? null
}

export async function getAfsShareById(id: string): Promise<AfsShare | null> {
  const { rows } = await pool.query('SELECT * FROM afs_shares WHERE id = $1', [id])
  return (rows[0] as AfsShare) ?? null
}

export async function deleteAfsShare(id: string): Promise<void> {
  await pool.query('DELETE FROM afs_shares WHERE id = $1', [id])
}

interface AfsShareSummary extends AfsShare {
  role: 'owner' | 'member'
  my_permission: AfsPermission
}

/**
 * Every share where `workspaceId` is either the owner or an active member.
 * Returns rows annotated with role and the permission this workspace holds.
 */
export async function listAfsSharesVisibleTo(workspaceId: string): Promise<AfsShareSummary[]> {
  const { rows } = await pool.query(
    `SELECT s.*,
            CASE WHEN s.owner_workspace_id = $1 THEN 'owner' ELSE 'member' END AS role,
            COALESCE(m.permission, 'read_write') AS my_permission
       FROM afs_shares s
       LEFT JOIN afs_share_members m
         ON m.share_id = s.id AND m.workspace_id = $1
      WHERE s.owner_workspace_id = $1 OR m.workspace_id IS NOT NULL
      ORDER BY s.created_at DESC`,
    [workspaceId],
  )
  return rows as AfsShareSummary[]
}

export async function removeAfsShareMember(shareId: string, workspaceId: string): Promise<boolean> {
  const r = await pool.query(
    'DELETE FROM afs_share_members WHERE share_id = $1 AND workspace_id = $2',
    [shareId, workspaceId],
  )
  return (r.rowCount ?? 0) > 0
}

export async function addAfsShareMember(
  shareId: string,
  workspaceId: string,
  permission: AfsPermission,
): Promise<void> {
  await pool.query(
    `INSERT INTO afs_share_members (share_id, workspace_id, permission)
     VALUES ($1, $2, $3)
     ON CONFLICT (share_id, workspace_id) DO UPDATE SET permission = EXCLUDED.permission`,
    [shareId, workspaceId, permission],
  )
}

interface AfsMountForWorkspace {
  share_id: string
  share_name: string
  afs_dir_id: string
  access_key: string
  permission: AfsPermission
}

/**
 * Shares this workspace currently has mounted (or should have mounted). Used
 * by the auto-remount path that fires when a workspace pod transitions to
 * running — `afs-mnt` is an emptyDir, so the previous mounts are gone after
 * any pod restart and we need to re-issue Mount RPCs for each membership.
 */
export async function listAfsMountsForWorkspace(
  workspaceId: string,
): Promise<AfsMountForWorkspace[]> {
  const { rows } = await pool.query(
    `SELECT s.id AS share_id, s.name AS share_name, s.afs_dir_id, s.access_key,
            m.permission
       FROM afs_share_members m
       JOIN afs_shares s ON s.id = m.share_id
      WHERE m.workspace_id = $1`,
    [workspaceId],
  )
  return rows as AfsMountForWorkspace[]
}

export async function listAfsShareMembers(shareId: string): Promise<AfsShareMember[]> {
  const { rows } = await pool.query(
    'SELECT * FROM afs_share_members WHERE share_id = $1 ORDER BY mounted_at',
    [shareId],
  )
  return rows as AfsShareMember[]
}
