import { pool } from './pool'

interface WorkspaceTeamShare {
  workspace_id: string
  team_id: string
  team_name: string
  created_by: string
  created_at: Date
}

/** Teams a workspace is shared with. */
export async function listWorkspaceTeamShares(workspaceId: string): Promise<WorkspaceTeamShare[]> {
  const { rows } = await pool.query(
    `SELECT s.*, t.name AS team_name
       FROM workspace_team_shares s
       JOIN teams t ON t.id = s.team_id
      WHERE s.workspace_id = $1
      ORDER BY s.created_at ASC`,
    [workspaceId],
  )
  return rows as WorkspaceTeamShare[]
}

export async function addWorkspaceTeamShare(
  workspaceId: string,
  teamId: string,
  createdBy: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO workspace_team_shares (workspace_id, team_id, created_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (workspace_id, team_id) DO NOTHING`,
    [workspaceId, teamId, createdBy],
  )
}

export async function removeWorkspaceTeamShare(
  workspaceId: string,
  teamId: string,
): Promise<boolean> {
  const r = await pool.query(
    'DELETE FROM workspace_team_shares WHERE workspace_id = $1 AND team_id = $2',
    [workspaceId, teamId],
  )
  return (r.rowCount ?? 0) > 0
}

/**
 * Drop the shares a user's workspaces hold with a team. Called when the user
 * leaves the team: a workspace may only be shared with a team its owner is in.
 */
export async function removeOwnerSharesForTeam(teamId: string, ownerId: string): Promise<void> {
  await pool.query(
    `DELETE FROM workspace_team_shares s
      USING workspaces w
      WHERE s.workspace_id = w.id AND s.team_id = $1 AND w.user_id = $2`,
    [teamId, ownerId],
  )
}

/** Whether `userId` reaches the workspace through a team it is shared with. */
export async function isWorkspaceSharedWithUser(
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1
       FROM workspace_team_shares s
       JOIN team_members m ON m.team_id = s.team_id
      WHERE s.workspace_id = $1 AND m.user_id = $2
      LIMIT 1`,
    [workspaceId, userId],
  )
  return rows.length > 0
}

/** Ids of the workspaces among `workspaceIds` that are shared with at least one team. */
export async function listSharedWorkspaceIds(workspaceIds: string[]): Promise<Set<string>> {
  if (workspaceIds.length === 0) return new Set()
  const { rows } = await pool.query(
    'SELECT DISTINCT workspace_id FROM workspace_team_shares WHERE workspace_id = ANY($1)',
    [workspaceIds],
  )
  return new Set(rows.map((r) => r.workspace_id as string))
}
