import { pool } from './pool'
import type { Environment } from './types'

// Visibility-aware access for environments — mirrors prompts/templates/providers
// exactly (private|team|public + *_grants joined to team_members). The built-in
// environment is visibility='public', so every user can see and place onto it.

type EnvironmentMyPermission = 'owner' | 'editor' | 'viewer' | 'public'

interface EnvironmentSharedTeam {
  id: string
  name: string
  permission: 'viewer' | 'editor'
}

export interface EnvironmentWithAccess extends Environment {
  owner_name: string
  is_owner: boolean
  my_permission: EnvironmentMyPermission
  shared_via_teams: EnvironmentSharedTeam[]
}

/**
 * Environments visible to the user — owned, public, or shared via team grants.
 * This is the placement candidate set (design §8): "which environments may this
 * user place workspaces onto".
 */
export async function listVisibleToUser(userId: string): Promise<EnvironmentWithAccess[]> {
  const { rows } = await pool.query(
    `WITH my_grants AS (
       SELECT eg.environment_id, eg.team_id, eg.permission, t.name AS team_name
         FROM environment_grants eg
         JOIN team_members tm ON tm.team_id = eg.team_id AND tm.user_id = $1
         JOIN teams t ON t.id = eg.team_id
     ),
     visible AS (
       SELECT e.id FROM environments e WHERE e.user_id = $1
       UNION
       SELECT e.id FROM environments e WHERE e.visibility = 'public'
       UNION
       SELECT environment_id FROM my_grants
     )
     SELECT e.*,
            u.display_name AS owner_name,
            (e.user_id = $1) AS is_owner,
            COALESCE(
              (SELECT json_agg(json_build_object(
                 'id', mg.team_id,
                 'name', mg.team_name,
                 'permission', mg.permission
               ))
                 FROM my_grants mg WHERE mg.environment_id = e.id),
              '[]'::json
            ) AS shared_via_teams,
            COALESCE(
              (SELECT MAX(CASE permission WHEN 'editor' THEN 2 WHEN 'viewer' THEN 1 END)
                 FROM my_grants mg WHERE mg.environment_id = e.id),
              0
            ) AS grant_rank
       FROM environments e
       JOIN users u ON u.id = e.user_id
      WHERE e.id IN (SELECT id FROM visible)
      ORDER BY e.is_builtin DESC, e.name`,
    [userId],
  )
  return rows.map((r) => decorateEnvironment(r, userId))
}

export async function getEnvironmentForUser(
  id: string,
  userId: string,
): Promise<EnvironmentWithAccess | null> {
  const { rows } = await pool.query(
    `WITH my_grants AS (
       SELECT eg.environment_id, eg.team_id, eg.permission, t.name AS team_name
         FROM environment_grants eg
         JOIN team_members tm ON tm.team_id = eg.team_id AND tm.user_id = $2
         JOIN teams t ON t.id = eg.team_id
        WHERE eg.environment_id = $1
     )
     SELECT e.*,
            u.display_name AS owner_name,
            (e.user_id = $2) AS is_owner,
            COALESCE(
              (SELECT json_agg(json_build_object(
                 'id', mg.team_id,
                 'name', mg.team_name,
                 'permission', mg.permission
               )) FROM my_grants mg),
              '[]'::json
            ) AS shared_via_teams,
            COALESCE(
              (SELECT MAX(CASE permission WHEN 'editor' THEN 2 WHEN 'viewer' THEN 1 END)
                 FROM my_grants),
              0
            ) AS grant_rank
       FROM environments e
       JOIN users u ON u.id = e.user_id
      WHERE e.id = $1`,
    [id, userId],
  )
  if (rows.length === 0) return null
  const row = rows[0]
  const isOwner = row.user_id === userId
  const isPublic = row.visibility === 'public'
  const grantRank = Number(row.grant_rank) || 0
  if (!isOwner && !isPublic && grantRank === 0) return null
  return decorateEnvironment(row, userId)
}

function decorateEnvironment(
  row: Environment & {
    owner_name: string
    is_owner: boolean
    shared_via_teams: EnvironmentSharedTeam[] | string
    grant_rank: number | string
  },
  userId: string,
): EnvironmentWithAccess {
  const sharedRaw = row.shared_via_teams
  const shared_via_teams: EnvironmentSharedTeam[] =
    typeof sharedRaw === 'string' ? JSON.parse(sharedRaw) : sharedRaw
  const grantRank = Number(row.grant_rank) || 0
  const isOwner = row.user_id === userId
  let my_permission: EnvironmentMyPermission
  if (isOwner) my_permission = 'owner'
  else if (grantRank === 2) my_permission = 'editor'
  else if (grantRank === 1) my_permission = 'viewer'
  else my_permission = 'public'
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    visibility: row.visibility,
    kind: row.kind,
    status: row.status,
    capabilities: row.capabilities,
    placement: row.placement,
    last_heartbeat_at: row.last_heartbeat_at,
    is_builtin: row.is_builtin,
    created_at: row.created_at,
    owner_name: row.owner_name,
    is_owner: isOwner,
    my_permission,
    shared_via_teams,
  }
}
