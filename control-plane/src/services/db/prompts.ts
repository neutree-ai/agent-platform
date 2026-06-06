import { generateId, pool } from './pool'
import type { Prompt, PromptVersion, PromptVisibility } from './types'

type PromptMyPermission = 'owner' | 'editor' | 'viewer' | 'public'

interface PromptSharedTeam {
  id: string
  name: string
  permission: 'viewer' | 'editor'
}

export interface PromptWithAccess extends Prompt {
  owner_name: string
  is_owner: boolean
  my_permission: PromptMyPermission
  shared_via_teams: PromptSharedTeam[]
}

interface PromptGrantInput {
  team_id: string
  permission: 'viewer' | 'editor'
}

interface PromptGrantRow {
  team_id: string
  team_name: string
  permission: 'viewer' | 'editor'
  granted_at: string
}

export async function createPrompt(
  userId: string,
  name: string,
  content: string,
  visibility: PromptVisibility,
): Promise<Prompt> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const id = generateId()
    const versionId = generateId()
    await client.query(
      `INSERT INTO prompts (id, user_id, name, content, visibility, is_public, current_version)
       VALUES ($1, $2, $3, $4, $5, $6, 1)`,
      [id, userId, name, content, visibility, visibility === 'public'],
    )
    await client.query(
      `INSERT INTO prompt_versions (id, prompt_id, version, content)
       VALUES ($1, $2, 1, $3)`,
      [versionId, id, content],
    )
    await client.query('COMMIT')
    return (await getPrompt(id))!
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

export async function getPrompt(id: string): Promise<Prompt | null> {
  const { rows } = await pool.query('SELECT * FROM prompts WHERE id = $1', [id])
  return (rows[0] as Prompt) ?? null
}

/**
 * Prompts visible to the user — owned, public, or shared via team grants.
 * Returns access metadata used by both list and detail responses.
 */
export async function listVisibleToUser(userId: string): Promise<PromptWithAccess[]> {
  const { rows } = await pool.query(
    `WITH my_grants AS (
       SELECT pg.prompt_id, pg.team_id, pg.permission, t.name AS team_name
         FROM prompt_grants pg
         JOIN team_members tm ON tm.team_id = pg.team_id AND tm.user_id = $1
         JOIN teams t ON t.id = pg.team_id
     ),
     visible AS (
       SELECT p.id FROM prompts p WHERE p.user_id = $1
       UNION
       SELECT p.id FROM prompts p WHERE p.visibility = 'public'
       UNION
       SELECT prompt_id FROM my_grants
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
                 FROM my_grants mg WHERE mg.prompt_id = p.id),
              '[]'::json
            ) AS shared_via_teams,
            COALESCE(
              (SELECT MAX(CASE permission WHEN 'editor' THEN 2 WHEN 'viewer' THEN 1 END)
                 FROM my_grants mg WHERE mg.prompt_id = p.id),
              0
            ) AS grant_rank
       FROM prompts p
       JOIN users u ON u.id = p.user_id
      WHERE p.id IN (SELECT id FROM visible)
      ORDER BY p.name`,
    [userId],
  )
  return rows.map((r) => decoratePrompt(r, userId))
}

export async function getPromptForUser(
  id: string,
  userId: string,
): Promise<PromptWithAccess | null> {
  const { rows } = await pool.query(
    `WITH my_grants AS (
       SELECT pg.prompt_id, pg.team_id, pg.permission, t.name AS team_name
         FROM prompt_grants pg
         JOIN team_members tm ON tm.team_id = pg.team_id AND tm.user_id = $2
         JOIN teams t ON t.id = pg.team_id
        WHERE pg.prompt_id = $1
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
       FROM prompts p
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
  return decoratePrompt(row, userId)
}

function decoratePrompt(
  row: Prompt & {
    owner_name: string
    is_owner: boolean
    shared_via_teams: PromptSharedTeam[] | string
    grant_rank: number | string
  },
  userId: string,
): PromptWithAccess {
  const sharedRaw = row.shared_via_teams
  const shared_via_teams: PromptSharedTeam[] =
    typeof sharedRaw === 'string' ? JSON.parse(sharedRaw) : sharedRaw
  const grantRank = Number(row.grant_rank) || 0
  const isOwner = row.user_id === userId
  let my_permission: PromptMyPermission
  if (isOwner) my_permission = 'owner'
  else if (grantRank === 2) my_permission = 'editor'
  else if (grantRank === 1) my_permission = 'viewer'
  else my_permission = 'public'
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    content: row.content,
    visibility: row.visibility,
    is_public: row.is_public,
    current_version: row.current_version,
    created_at: row.created_at,
    updated_at: row.updated_at,
    owner_name: row.owner_name,
    is_owner: isOwner,
    my_permission,
    shared_via_teams,
  }
}

export async function updatePrompt(
  id: string,
  updates: Partial<Pick<Prompt, 'name' | 'content' | 'visibility'>>,
): Promise<Prompt | null> {
  const existing = await getPrompt(id)
  if (!existing) return null

  const contentChanged = updates.content !== undefined && updates.content !== existing.content

  if (contentChanged) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const newVersion = existing.current_version + 1
      const versionId = generateId()

      const sets: string[] = ['content = $1', 'current_version = $2', 'updated_at = NOW()']
      const values: unknown[] = [updates.content, newVersion]
      let paramIndex = 3

      if (updates.name !== undefined) {
        sets.push(`name = $${paramIndex++}`)
        values.push(updates.name)
      }
      if (updates.visibility !== undefined) {
        sets.push(`visibility = $${paramIndex++}`)
        values.push(updates.visibility)
        sets.push(`is_public = $${paramIndex++}`)
        values.push(updates.visibility === 'public')
      }

      values.push(id)
      await client.query(`UPDATE prompts SET ${sets.join(', ')} WHERE id = $${paramIndex}`, values)
      await client.query(
        `INSERT INTO prompt_versions (id, prompt_id, version, content)
         VALUES ($1, $2, $3, $4)`,
        [versionId, id, newVersion, updates.content],
      )
      await client.query('COMMIT')
      return await getPrompt(id)
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  }

  // No content change — simple update
  const sets: string[] = ['updated_at = NOW()']
  const values: unknown[] = []
  let paramIndex = 1

  if (updates.name !== undefined) {
    sets.push(`name = $${paramIndex++}`)
    values.push(updates.name)
  }
  if (updates.visibility !== undefined) {
    sets.push(`visibility = $${paramIndex++}`)
    values.push(updates.visibility)
    sets.push(`is_public = $${paramIndex++}`)
    values.push(updates.visibility === 'public')
  }

  if (values.length === 0) return existing

  values.push(id)
  await pool.query(`UPDATE prompts SET ${sets.join(', ')} WHERE id = $${paramIndex}`, values)
  return await getPrompt(id)
}

export async function deletePrompt(id: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM prompts WHERE id = $1', [id])
  return (result.rowCount ?? 0) > 0
}

export async function listPromptVersions(promptId: string): Promise<PromptVersion[]> {
  const { rows } = await pool.query(
    'SELECT * FROM prompt_versions WHERE prompt_id = $1 ORDER BY version DESC',
    [promptId],
  )
  return rows as PromptVersion[]
}

async function getPromptVersion(promptId: string, version: number): Promise<PromptVersion | null> {
  const { rows } = await pool.query(
    'SELECT * FROM prompt_versions WHERE prompt_id = $1 AND version = $2',
    [promptId, version],
  )
  return (rows[0] as PromptVersion) ?? null
}

export async function rollbackPromptToVersion(id: string, version: number): Promise<Prompt | null> {
  const existing = await getPrompt(id)
  if (!existing) return null
  const targetVersion = await getPromptVersion(id, version)
  if (!targetVersion) return null

  return await updatePrompt(id, { content: targetVersion.content })
}

// ── Grants ──

export async function listPromptGrants(promptId: string): Promise<PromptGrantRow[]> {
  const { rows } = await pool.query(
    `SELECT pg.team_id, t.name AS team_name, pg.permission, pg.granted_at
       FROM prompt_grants pg
       JOIN teams t ON t.id = pg.team_id
      WHERE pg.prompt_id = $1
      ORDER BY pg.granted_at ASC`,
    [promptId],
  )
  return rows as PromptGrantRow[]
}

/**
 * Replace the full grant set for a prompt. Existing grants not in `grants` are
 * deleted; new ones are inserted; permission changes are applied via upsert.
 */
export async function setPromptGrants(
  promptId: string,
  grants: PromptGrantInput[],
  grantedBy: string,
): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (grants.length === 0) {
      await client.query('DELETE FROM prompt_grants WHERE prompt_id = $1', [promptId])
    } else {
      const teamIds = grants.map((g) => g.team_id)
      await client.query(
        'DELETE FROM prompt_grants WHERE prompt_id = $1 AND team_id <> ALL($2::text[])',
        [promptId, teamIds],
      )
      for (const g of grants) {
        await client.query(
          `INSERT INTO prompt_grants (prompt_id, team_id, permission, granted_by)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (prompt_id, team_id)
           DO UPDATE SET permission = EXCLUDED.permission, granted_by = EXCLUDED.granted_by`,
          [promptId, g.team_id, g.permission, grantedBy],
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
