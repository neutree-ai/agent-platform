import { generateId, pool } from './pool'
import type { WorkspaceTag } from './types'

export async function listUserTags(userId: string): Promise<WorkspaceTag[]> {
  const { rows } = await pool.query(
    'SELECT * FROM workspace_tags WHERE user_id = $1 ORDER BY name',
    [userId],
  )
  return rows as WorkspaceTag[]
}

export async function createTag(
  userId: string,
  name: string,
  color: string,
): Promise<WorkspaceTag> {
  const id = generateId()
  await pool.query(
    'INSERT INTO workspace_tags (id, user_id, name, color) VALUES ($1, $2, $3, $4)',
    [id, userId, name, color],
  )
  const { rows } = await pool.query('SELECT * FROM workspace_tags WHERE id = $1', [id])
  return rows[0] as WorkspaceTag
}

export async function updateTag(
  id: string,
  userId: string,
  updates: Partial<Pick<WorkspaceTag, 'name' | 'color'>>,
): Promise<WorkspaceTag | null> {
  const sets: string[] = []
  const values: any[] = []
  let paramIndex = 1

  if (updates.name !== undefined) {
    sets.push(`name = $${paramIndex++}`)
    values.push(updates.name)
  }
  if (updates.color !== undefined) {
    sets.push(`color = $${paramIndex++}`)
    values.push(updates.color)
  }

  if (sets.length === 0) return null

  values.push(id, userId)
  const result = await pool.query(
    `UPDATE workspace_tags SET ${sets.join(', ')} WHERE id = $${paramIndex++} AND user_id = $${paramIndex}`,
    values,
  )
  if ((result.rowCount ?? 0) === 0) return null
  const { rows } = await pool.query('SELECT * FROM workspace_tags WHERE id = $1', [id])
  return (rows[0] as WorkspaceTag) ?? null
}

export async function deleteTag(id: string, userId: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM workspace_tags WHERE id = $1 AND user_id = $2', [
    id,
    userId,
  ])
  return (result.rowCount ?? 0) > 0
}

export async function getTagAssignmentsForUser(userId: string): Promise<Record<string, string[]>> {
  const { rows } = await pool.query(
    `SELECT wta.workspace_id, wta.tag_id
     FROM workspace_tag_assignments wta
     JOIN workspace_tags wt ON wta.tag_id = wt.id
     WHERE wt.user_id = $1`,
    [userId],
  )
  const result: Record<string, string[]> = {}
  for (const row of rows as { workspace_id: string; tag_id: string }[]) {
    if (!result[row.workspace_id]) result[row.workspace_id] = []
    result[row.workspace_id].push(row.tag_id)
  }
  return result
}

export async function setWorkspaceTags(workspaceId: string, tagIds: string[]): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM workspace_tag_assignments WHERE workspace_id = $1', [
      workspaceId,
    ])
    for (const tagId of tagIds) {
      await client.query(
        'INSERT INTO workspace_tag_assignments (workspace_id, tag_id) VALUES ($1, $2)',
        [workspaceId, tagId],
      )
    }
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}
