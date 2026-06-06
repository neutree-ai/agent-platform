import { generateId, pool } from './pool'
import type { ModelProvider, ProviderVisibility, Workspace } from './types'

type ProviderMyPermission = 'owner' | 'editor' | 'viewer' | 'public'

interface ProviderSharedTeam {
  id: string
  name: string
  permission: 'viewer' | 'editor'
}

export interface ProviderWithAccess extends ModelProvider {
  owner_name: string
  is_owner: boolean
  my_permission: ProviderMyPermission
  shared_via_teams: ProviderSharedTeam[]
}

interface ProviderGrantInput {
  team_id: string
  permission: 'viewer' | 'editor'
}

interface ProviderGrantRow {
  team_id: string
  team_name: string
  permission: 'viewer' | 'editor'
  granted_at: string
}

/**
 * Providers visible to the user — owned, public, or shared via team grants.
 * Returns access metadata used by both list and detail responses.
 */
export async function listVisibleToUser(userId: string): Promise<ProviderWithAccess[]> {
  const { rows } = await pool.query(
    `WITH my_grants AS (
       SELECT pg.provider_id, pg.team_id, pg.permission, t.name AS team_name
         FROM provider_grants pg
         JOIN team_members tm ON tm.team_id = pg.team_id AND tm.user_id = $1
         JOIN teams t ON t.id = pg.team_id
     ),
     visible AS (
       SELECT p.id FROM model_providers p WHERE p.user_id = $1
       UNION
       SELECT p.id FROM model_providers p WHERE p.visibility = 'public'
       UNION
       SELECT provider_id FROM my_grants
     )
     SELECT p.*,
            u.display_name AS owner_name,
            (p.user_id = $1) AS is_owner,
            COALESCE(
              (SELECT json_agg(json_build_object(
                 'id', mg.team_id,
                 'name', mg.team_name,
                 'permission', mg.permission
               ))
                 FROM my_grants mg WHERE mg.provider_id = p.id),
              '[]'::json
            ) AS shared_via_teams,
            COALESCE(
              (SELECT MAX(CASE permission WHEN 'editor' THEN 2 WHEN 'viewer' THEN 1 END)
                 FROM my_grants mg WHERE mg.provider_id = p.id),
              0
            ) AS grant_rank
       FROM model_providers p
       JOIN users u ON u.id = p.user_id
      WHERE p.id IN (SELECT id FROM visible)
      ORDER BY p.name`,
    [userId],
  )
  return rows.map((r) => decorateProvider(r, userId))
}

export async function getModelProvider(id: string): Promise<ModelProvider | null> {
  const { rows } = await pool.query('SELECT * FROM model_providers WHERE id = $1', [id])
  return (rows[0] as ModelProvider) ?? null
}

export async function getProviderForUser(
  id: string,
  userId: string,
): Promise<ProviderWithAccess | null> {
  const { rows } = await pool.query(
    `WITH my_grants AS (
       SELECT pg.provider_id, pg.team_id, pg.permission, t.name AS team_name
         FROM provider_grants pg
         JOIN team_members tm ON tm.team_id = pg.team_id AND tm.user_id = $2
         JOIN teams t ON t.id = pg.team_id
        WHERE pg.provider_id = $1
     )
     SELECT p.*,
            u.display_name AS owner_name,
            (p.user_id = $2) AS is_owner,
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
       FROM model_providers p
       JOIN users u ON u.id = p.user_id
      WHERE p.id = $1`,
    [id, userId],
  )
  if (rows.length === 0) return null
  const row = rows[0]
  const isOwner = row.user_id === userId
  const isPublic = row.visibility === 'public'
  const grantRank = Number(row.grant_rank) || 0
  if (!isOwner && !isPublic && grantRank === 0) return null
  return decorateProvider(row, userId)
}

function decorateProvider(
  row: ModelProvider & {
    owner_name: string
    is_owner: boolean
    shared_via_teams: ProviderSharedTeam[] | string
    grant_rank: number | string
  },
  userId: string,
): ProviderWithAccess {
  const sharedRaw = row.shared_via_teams
  const shared_via_teams: ProviderSharedTeam[] =
    typeof sharedRaw === 'string' ? JSON.parse(sharedRaw) : sharedRaw
  const grantRank = Number(row.grant_rank) || 0
  const isOwner = row.user_id === userId
  let my_permission: ProviderMyPermission
  if (isOwner) my_permission = 'owner'
  else if (grantRank === 2) my_permission = 'editor'
  else if (grantRank === 1) my_permission = 'viewer'
  else my_permission = 'public'
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    description: row.description,
    provider_type: row.provider_type,
    base_url: row.base_url,
    api_key: row.api_key,
    is_public: row.is_public,
    visibility: row.visibility,
    created_at: row.created_at,
    updated_at: row.updated_at,
    owner_name: row.owner_name,
    is_owner: isOwner,
    my_permission,
    shared_via_teams,
  }
}

export async function createModelProvider(
  name: string,
  opts: {
    description?: string
    provider_type: string
    base_url: string
    api_key: string
    user_id: string
    visibility: ProviderVisibility
  },
): Promise<ModelProvider> {
  const id = generateId()
  await pool.query(
    `INSERT INTO model_providers (id, name, description, provider_type, base_url, api_key, user_id, visibility, is_public)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      name,
      opts.description ?? '',
      opts.provider_type,
      opts.base_url,
      opts.api_key,
      opts.user_id,
      opts.visibility,
      opts.visibility === 'public',
    ],
  )
  return (await getModelProvider(id))!
}

export async function updateModelProvider(
  id: string,
  updates: Partial<
    Pick<
      ModelProvider,
      'name' | 'description' | 'provider_type' | 'base_url' | 'api_key' | 'visibility'
    >
  >,
): Promise<ModelProvider | null> {
  const sets: string[] = []
  const values: unknown[] = []
  let paramIndex = 1

  const fields = ['name', 'description', 'provider_type', 'base_url', 'api_key'] as const
  for (const field of fields) {
    if (updates[field] !== undefined) {
      sets.push(`${field} = $${paramIndex++}`)
      values.push(updates[field])
    }
  }

  if (updates.visibility !== undefined) {
    sets.push(`visibility = $${paramIndex++}`)
    values.push(updates.visibility)
    sets.push(`is_public = $${paramIndex++}`)
    values.push(updates.visibility === 'public')
  }

  if (sets.length === 0) return await getModelProvider(id)

  sets.push('updated_at = NOW()')
  values.push(id)
  await pool.query(
    `UPDATE model_providers SET ${sets.join(', ')} WHERE id = $${paramIndex}`,
    values,
  )
  return await getModelProvider(id)
}

export async function deleteModelProvider(id: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM model_providers WHERE id = $1', [id])
  return (result.rowCount ?? 0) > 0
}

export async function getRunningWorkspacesByProvider(
  providerId: string,
): Promise<Pick<Workspace, 'id'>[]> {
  const { rows } = await pool.query(
    `SELECT DISTINCT w.id FROM workspaces w
     JOIN workspace_config wc ON w.id = wc.workspace_id
     LEFT JOIN template_versions tv ON wc.template_id = tv.template_id AND wc.template_version = tv.version
     WHERE w.status = 'running'
       AND (wc.provider_id = $1 OR tv.provider_id = $1)`,
    [providerId],
  )
  return rows
}

export async function getWorkspacesUsingProvider(
  providerId: string,
): Promise<{ id: string; name: string }[]> {
  const { rows } = await pool.query(
    `SELECT DISTINCT w.id, w.name FROM workspaces w
     JOIN workspace_config wc ON w.id = wc.workspace_id
     LEFT JOIN template_versions tv ON wc.template_id = tv.template_id AND wc.template_version = tv.version
     WHERE wc.provider_id = $1 OR tv.provider_id = $1
     ORDER BY w.name`,
    [providerId],
  )
  return rows as { id: string; name: string }[]
}

// ── Grants ──

export async function listProviderGrants(providerId: string): Promise<ProviderGrantRow[]> {
  const { rows } = await pool.query(
    `SELECT pg.team_id, t.name AS team_name, pg.permission, pg.granted_at
       FROM provider_grants pg
       JOIN teams t ON t.id = pg.team_id
      WHERE pg.provider_id = $1
      ORDER BY pg.granted_at ASC`,
    [providerId],
  )
  return rows as ProviderGrantRow[]
}

/**
 * Replace the full grant set for a provider. Existing grants not in `grants`
 * are deleted; new ones are inserted; permission changes apply via upsert.
 */
export async function setProviderGrants(
  providerId: string,
  grants: ProviderGrantInput[],
  grantedBy: string,
): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (grants.length === 0) {
      await client.query('DELETE FROM provider_grants WHERE provider_id = $1', [providerId])
    } else {
      const teamIds = grants.map((g) => g.team_id)
      await client.query(
        'DELETE FROM provider_grants WHERE provider_id = $1 AND team_id <> ALL($2::text[])',
        [providerId, teamIds],
      )
      for (const g of grants) {
        await client.query(
          `INSERT INTO provider_grants (provider_id, team_id, permission, granted_by)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (provider_id, team_id)
           DO UPDATE SET permission = EXCLUDED.permission, granted_by = EXCLUDED.granted_by`,
          [providerId, g.team_id, g.permission, grantedBy],
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
