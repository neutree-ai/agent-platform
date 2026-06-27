import { generateId, pool } from './pool'
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

// ── Write side (P2: register remote environments + share via teams) ──

interface EnvironmentGrantInput {
  team_id: string
  permission: 'viewer' | 'editor'
}

interface EnvironmentGrantRow {
  team_id: string
  team_name: string
  permission: 'viewer' | 'editor'
  granted_at: string
}

/**
 * Create a remote environment owned by `userId`. New environments start
 * status='pending' (no runner has checked in yet) and is_builtin=false — the
 * built-in row is seeded by migration and never created here.
 */
export async function createEnvironment(
  userId: string,
  name: string,
  kind: string,
  visibility: 'private' | 'team' | 'public',
  placement: Record<string, unknown> = {},
): Promise<Environment> {
  const id = generateId()
  const { rows } = await pool.query(
    `INSERT INTO environments (id, user_id, name, visibility, kind, status, placement, is_builtin)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6, false)
     RETURNING *`,
    [id, userId, name, visibility, kind, JSON.stringify(placement)],
  )
  return rows[0] as Environment
}

export async function updateEnvironment(
  id: string,
  fields: {
    name?: string
    visibility?: 'private' | 'team' | 'public'
    placement?: Record<string, unknown>
  },
): Promise<boolean> {
  const sets: string[] = []
  const vals: unknown[] = [id]
  if (fields.name !== undefined) {
    vals.push(fields.name)
    sets.push(`name = $${vals.length}`)
  }
  if (fields.visibility !== undefined) {
    vals.push(fields.visibility)
    sets.push(`visibility = $${vals.length}`)
  }
  if (fields.placement !== undefined) {
    vals.push(JSON.stringify(fields.placement))
    sets.push(`placement = $${vals.length}`)
  }
  if (sets.length === 0) return false
  // Never let the API mutate the built-in row.
  const result = await pool.query(
    `UPDATE environments SET ${sets.join(', ')} WHERE id = $1 AND is_builtin = false`,
    vals,
  )
  return (result.rowCount ?? 0) > 0
}

/** Delete a remote environment (owner only, never built-in). */
export async function deleteEnvironment(id: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM environments WHERE id = $1 AND is_builtin = false', [
    id,
  ])
  return (result.rowCount ?? 0) > 0
}

export async function listEnvironmentGrants(environmentId: string): Promise<EnvironmentGrantRow[]> {
  const { rows } = await pool.query(
    `SELECT eg.team_id, t.name AS team_name, eg.permission, eg.granted_at
       FROM environment_grants eg
       JOIN teams t ON t.id = eg.team_id
      WHERE eg.environment_id = $1
      ORDER BY eg.granted_at ASC`,
    [environmentId],
  )
  return rows as EnvironmentGrantRow[]
}

/**
 * Replace the full grant set for an environment — mirrors setPromptGrants:
 * grants not in the list are removed, the rest upserted.
 */
export async function setEnvironmentGrants(
  environmentId: string,
  grants: EnvironmentGrantInput[],
  grantedBy: string,
): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (grants.length === 0) {
      await client.query('DELETE FROM environment_grants WHERE environment_id = $1', [
        environmentId,
      ])
    } else {
      const teamIds = grants.map((g) => g.team_id)
      await client.query(
        'DELETE FROM environment_grants WHERE environment_id = $1 AND team_id <> ALL($2::text[])',
        [environmentId, teamIds],
      )
      for (const g of grants) {
        await client.query(
          `INSERT INTO environment_grants (environment_id, team_id, permission, granted_by)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (environment_id, team_id)
           DO UPDATE SET permission = EXCLUDED.permission, granted_by = EXCLUDED.granted_by`,
          [environmentId, g.team_id, g.permission, grantedBy],
        )
      }
    }
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
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
