import { generateId, pool } from './pool'

export interface AfsShare {
  id: string
  owner_workspace_id: string
  name: string
  afs_dir_id: string
  access_key: string
  created_at: Date
}

export type AfsPermission = 'read_only' | 'read_write'

/** 'team': mounted by a member of a team the folder is granted to. 'direct': any other way. */
type AfsMemberSource = 'direct' | 'team'

interface AfsShareMember {
  share_id: string
  workspace_id: string
  permission: AfsPermission
  source: AfsMemberSource
  /** Null: mounted at the folder's own name. */
  mount_name: string | null
  mounted_at: Date
}

/** Where a member has the folder: /mnt/afs/<this>. */
export function memberMountName(
  member: Pick<AfsShareMember, 'mount_name'>,
  share: Pick<AfsShare, 'name'>,
): string {
  return member.mount_name ?? share.name
}

/**
 * The highest permission the grants of share `s.id` give user `owner.u`,
 * through the teams the user is in; null when none does. Put in a query that
 * has `s` (afs_shares) and `owner` (a lateral giving the user as `u`).
 */
const CEILING_SQL = `(SELECT CASE
          WHEN bool_or(g.permission = 'read_write') THEN 'read_write'
          WHEN count(*) > 0 THEN 'read_only'
        END
   FROM afs_share_grants g
   JOIN team_members tm ON tm.team_id = g.team_id
  WHERE g.share_id = s.id AND tm.user_id = owner.u)`

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
  /** Where this workspace has the folder: /mnt/afs/<this>. */
  mount_name: string
  source: AfsMemberSource
  owner_user_id: string
  owner_display_name: string
  /** Workspaces other than the owner's that have the folder. */
  other_member_count: number
  /** Teams the folder is granted to. */
  grant_count: number
}

/**
 * Every share where `workspaceId` is either the owner or an active member.
 * Returns rows annotated with role and the permission this workspace holds.
 */
export async function listAfsSharesVisibleTo(workspaceId: string): Promise<AfsShareSummary[]> {
  const { rows } = await pool.query(
    `SELECT s.*,
            CASE WHEN s.owner_workspace_id = $1 THEN 'owner' ELSE 'member' END AS role,
            COALESCE(m.permission, 'read_write') AS my_permission,
            COALESCE(m.mount_name, s.name) AS mount_name,
            COALESCE(m.source, 'direct') AS source,
            ow.user_id AS owner_user_id,
            ou.display_name AS owner_display_name,
            (SELECT count(*)::int FROM afs_share_members om
              WHERE om.share_id = s.id AND om.workspace_id <> s.owner_workspace_id)
              AS other_member_count,
            (SELECT count(*)::int FROM afs_share_grants g WHERE g.share_id = s.id) AS grant_count
       FROM afs_shares s
       JOIN workspaces ow ON ow.id = s.owner_workspace_id
       JOIN users ou ON ou.id = ow.user_id
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
     ON CONFLICT (share_id, workspace_id)
       DO UPDATE SET permission = EXCLUDED.permission, source = 'direct'`,
    [shareId, workspaceId, permission],
  )
}

/** Record a team mount of the folder in the workspace, or change its permission. */
export async function addAfsTeamMount(
  shareId: string,
  workspaceId: string,
  permission: AfsPermission,
  mountName: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO afs_share_members (share_id, workspace_id, permission, source, mount_name)
     VALUES ($1, $2, $3, 'team', $4)
     ON CONFLICT (share_id, workspace_id)
       DO UPDATE SET permission = EXCLUDED.permission, mount_name = EXCLUDED.mount_name`,
    [shareId, workspaceId, permission, mountName],
  )
}

/** Set a member's permission, leaving how it came to have the folder as it is. */
export async function setAfsMemberPermission(
  shareId: string,
  workspaceId: string,
  permission: AfsPermission,
): Promise<void> {
  await pool.query(
    'UPDATE afs_share_members SET permission = $3 WHERE share_id = $1 AND workspace_id = $2',
    [shareId, workspaceId, permission],
  )
}

/** The names the workspace has folders mounted at, under /mnt/afs. */
export async function listAfsMountNames(workspaceId: string): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT COALESCE(m.mount_name, s.name) AS name
       FROM afs_share_members m
       JOIN afs_shares s ON s.id = m.share_id
      WHERE m.workspace_id = $1`,
    [workspaceId],
  )
  return rows.map((r) => r.name as string)
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
  // A team mount is only listed while a grant still allows it, so a pod
  // never mounts a folder its owner's access to was taken away from while it
  // was down; reconcileTeamMounts deletes the row.
  const { rows } = await pool.query(
    `SELECT s.id AS share_id, COALESCE(m.mount_name, s.name) AS share_name,
            s.afs_dir_id, s.access_key, m.permission
       FROM afs_share_members m
       JOIN afs_shares s ON s.id = m.share_id
       JOIN workspaces w ON w.id = m.workspace_id
      CROSS JOIN LATERAL (SELECT w.user_id AS u) owner
      CROSS JOIN LATERAL (SELECT ${CEILING_SQL} AS ceiling) c
      WHERE m.workspace_id = $1
        AND (m.source = 'direct'
          OR c.ceiling = 'read_write'
          OR (c.ceiling = 'read_only' AND m.permission = 'read_only'))`,
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

// ── Team grants ─────────────────────────────────────────────────────────────

interface AfsShareGrant {
  share_id: string
  team_id: string
  team_name: string
  permission: AfsPermission
  granted_by: string
  granted_at: Date
}

export async function listAfsShareGrants(shareId: string): Promise<AfsShareGrant[]> {
  const { rows } = await pool.query(
    `SELECT g.*, t.name AS team_name
       FROM afs_share_grants g
       JOIN teams t ON t.id = g.team_id
      WHERE g.share_id = $1
      ORDER BY g.granted_at`,
    [shareId],
  )
  return rows as AfsShareGrant[]
}

export async function upsertAfsShareGrant(
  shareId: string,
  teamId: string,
  permission: AfsPermission,
  grantedBy: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO afs_share_grants (share_id, team_id, permission, granted_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (share_id, team_id)
       DO UPDATE SET permission = EXCLUDED.permission, granted_by = EXCLUDED.granted_by`,
    [shareId, teamId, permission, grantedBy],
  )
}

export async function deleteAfsShareGrant(shareId: string, teamId: string): Promise<boolean> {
  const r = await pool.query('DELETE FROM afs_share_grants WHERE share_id = $1 AND team_id = $2', [
    shareId,
    teamId,
  ])
  return (r.rowCount ?? 0) > 0
}

/**
 * Drop the grants a user's folders hold with a team. Called when the user
 * leaves the team: a folder may only be granted to a team its owner is in.
 */
export async function removeOwnerAfsGrantsForTeam(teamId: string, ownerId: string): Promise<void> {
  await pool.query(
    `DELETE FROM afs_share_grants g
      USING afs_shares s, workspaces w
      WHERE g.share_id = s.id AND s.owner_workspace_id = w.id
        AND g.team_id = $1 AND w.user_id = $2`,
    [teamId, ownerId],
  )
}

/** The highest permission the folder's grants give the user; null when none does. */
export async function getAfsGrantCeiling(
  shareId: string,
  userId: string,
): Promise<AfsPermission | null> {
  const { rows } = await pool.query(
    `SELECT ${CEILING_SQL} AS ceiling
       FROM afs_shares s CROSS JOIN LATERAL (SELECT $2::text AS u) owner
      WHERE s.id = $1`,
    [shareId, userId],
  )
  return (rows[0]?.ceiling as AfsPermission | null) ?? null
}

interface AfsAvailableShare {
  id: string
  name: string
  owner_user_id: string
  owner_display_name: string
  /** The highest permission the grants give the workspace's owner. */
  ceiling: AfsPermission
  /** The teams, of the workspace owner's, the folder is granted to. */
  team_names: string[]
  created_at: Date
}

/**
 * Folders of other users granted to a team the workspace's owner is in, that
 * the workspace doesn't have yet.
 */
export async function listAfsSharesAvailableTo(workspaceId: string): Promise<AfsAvailableShare[]> {
  const { rows } = await pool.query(
    `SELECT s.id, s.name, s.created_at,
            ow.user_id AS owner_user_id, ou.display_name AS owner_display_name,
            CASE WHEN bool_or(g.permission = 'read_write') THEN 'read_write' ELSE 'read_only' END
              AS ceiling,
            array_agg(DISTINCT t.name ORDER BY t.name) AS team_names
       FROM workspaces w
       JOIN team_members tm ON tm.user_id = w.user_id
       JOIN afs_share_grants g ON g.team_id = tm.team_id
       JOIN teams t ON t.id = g.team_id
       JOIN afs_shares s ON s.id = g.share_id
       JOIN workspaces ow ON ow.id = s.owner_workspace_id
       JOIN users ou ON ou.id = ow.user_id
      WHERE w.id = $1
        AND ow.user_id <> w.user_id
        AND NOT EXISTS (SELECT 1 FROM afs_share_members m
                         WHERE m.share_id = s.id AND m.workspace_id = w.id)
      GROUP BY s.id, ow.user_id, ou.display_name
      ORDER BY s.created_at DESC`,
    [workspaceId],
  )
  return rows as AfsAvailableShare[]
}

interface AfsTeamMountCheck {
  share: AfsShare
  workspace_id: string
  permission: AfsPermission
  mount_name: string
  ceiling: AfsPermission | null
}

/** Every team mount, with the highest permission its grants give the workspace's owner now. */
export async function listAfsTeamMountsWithCeiling(): Promise<AfsTeamMountCheck[]> {
  const { rows } = await pool.query(
    `SELECT s.id, s.owner_workspace_id, s.name, s.afs_dir_id, s.access_key, s.created_at,
            m.workspace_id, m.permission, COALESCE(m.mount_name, s.name) AS mount_name,
            c.ceiling
       FROM afs_share_members m
       JOIN afs_shares s ON s.id = m.share_id
       JOIN workspaces w ON w.id = m.workspace_id
      CROSS JOIN LATERAL (SELECT w.user_id AS u) owner
      CROSS JOIN LATERAL (SELECT ${CEILING_SQL} AS ceiling) c
      WHERE m.source = 'team'`,
  )
  return rows.map((r) => ({
    share: {
      id: r.id,
      owner_workspace_id: r.owner_workspace_id,
      name: r.name,
      afs_dir_id: r.afs_dir_id,
      access_key: r.access_key,
      created_at: r.created_at,
    },
    workspace_id: r.workspace_id,
    permission: r.permission,
    mount_name: r.mount_name,
    ceiling: r.ceiling,
  }))
}

/** The folders the workspace owns. */
export async function listAfsSharesOwnedBy(workspaceId: string): Promise<AfsShare[]> {
  const { rows } = await pool.query('SELECT * FROM afs_shares WHERE owner_workspace_id = $1', [
    workspaceId,
  ])
  return rows as AfsShare[]
}

interface AfsShareMemberDetail extends AfsShareMember {
  workspace_name: string
  user_id: string
  user_display_name: string
}

/** The folder's members, with whose workspace each is. */
export async function listAfsShareMemberDetails(shareId: string): Promise<AfsShareMemberDetail[]> {
  const { rows } = await pool.query(
    `SELECT m.*, w.name AS workspace_name, w.user_id, u.display_name AS user_display_name
       FROM afs_share_members m
       JOIN workspaces w ON w.id = m.workspace_id
       JOIN users u ON u.id = w.user_id
      WHERE m.share_id = $1
      ORDER BY m.mounted_at`,
    [shareId],
  )
  return rows as AfsShareMemberDetail[]
}
