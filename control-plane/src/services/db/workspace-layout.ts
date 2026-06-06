import type { LayoutSkeleton } from '../../../../internal/types/api'
import { generateId, pool } from './pool'
import type { WorkspaceLayout } from './types'

/**
 * Reusable named layout skeletons. A layout carries no sensitive content, so it
 * has no visibility/grant model: `list` is owner-only, while `get` by id is
 * open (only ever hit transiently to copy a template's referenced layout into a
 * recipient-owned row). See migration 114.
 */

function rowToLayout(row: {
  id: string
  owner_id: string
  name: string
  description: string
  skeleton: LayoutSkeleton
  origin: 'local' | 'template'
  source_template_id: string | null
  created_at: string
  updated_at: string
}): WorkspaceLayout {
  return row
}

/** The user's own layouts (custom + template-origin copies). Owner-only list. */
export async function listWorkspaceLayouts(ownerId: string): Promise<WorkspaceLayout[]> {
  const { rows } = await pool.query(
    `SELECT id, owner_id, name, description, skeleton, origin, source_template_id,
            created_at, updated_at
       FROM workspace_layout
      WHERE owner_id = $1
      ORDER BY updated_at DESC`,
    [ownerId],
  )
  return rows.map(rowToLayout)
}

/** Resolve a single layout by id (open read — used to copy a referenced row). */
export async function getWorkspaceLayout(id: string): Promise<WorkspaceLayout | null> {
  const { rows } = await pool.query(
    `SELECT id, owner_id, name, description, skeleton, origin, source_template_id,
            created_at, updated_at
       FROM workspace_layout
      WHERE id = $1`,
    [id],
  )
  return rows[0] ? rowToLayout(rows[0]) : null
}

export async function createWorkspaceLayout(
  ownerId: string,
  input: { name: string; description?: string; skeleton: LayoutSkeleton },
): Promise<WorkspaceLayout> {
  const id = generateId()
  await pool.query(
    `INSERT INTO workspace_layout (id, owner_id, name, description, skeleton, origin)
     VALUES ($1, $2, $3, $4, $5::jsonb, 'local')`,
    [id, ownerId, input.name, input.description ?? '', JSON.stringify(input.skeleton)],
  )
  return (await getWorkspaceLayout(id))!
}

export async function updateWorkspaceLayout(
  id: string,
  updates: { name?: string; description?: string; skeleton?: LayoutSkeleton },
): Promise<WorkspaceLayout | null> {
  const sets: string[] = []
  const values: unknown[] = []
  let i = 1
  if (updates.name !== undefined) {
    sets.push(`name = $${i++}`)
    values.push(updates.name)
  }
  if (updates.description !== undefined) {
    sets.push(`description = $${i++}`)
    values.push(updates.description)
  }
  if (updates.skeleton !== undefined) {
    sets.push(`skeleton = $${i++}::jsonb`)
    values.push(JSON.stringify(updates.skeleton))
  }
  if (sets.length === 0) return getWorkspaceLayout(id)
  sets.push('updated_at = now()')
  values.push(id)
  await pool.query(`UPDATE workspace_layout SET ${sets.join(', ')} WHERE id = $${i}`, values)
  return getWorkspaceLayout(id)
}

export async function deleteWorkspaceLayout(id: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM workspace_layout WHERE id = $1', [id])
  return (result.rowCount ?? 0) > 0
}

/** The recipient's template-origin copy for a given source template, if any. */
export async function getTemplateLayoutCopy(
  ownerId: string,
  sourceTemplateId: string,
): Promise<WorkspaceLayout | null> {
  const { rows } = await pool.query(
    `SELECT id, owner_id, name, description, skeleton, origin, source_template_id,
            created_at, updated_at
       FROM workspace_layout
      WHERE owner_id = $1 AND source_template_id = $2 AND origin = 'template'`,
    [ownerId, sourceTemplateId],
  )
  return rows[0] ? rowToLayout(rows[0]) : null
}

/**
 * Copy-on-receipt: ensure the recipient owns a `origin='template'` layout row
 * mirroring `skeleton`, deduped to one row per (owner, source template). Used
 * by create-from-template and sync. Returns the recipient-owned copy.
 */
export async function upsertTemplateLayoutCopy(
  ownerId: string,
  sourceTemplateId: string,
  name: string,
  skeleton: LayoutSkeleton,
): Promise<WorkspaceLayout> {
  const id = generateId()
  const { rows } = await pool.query(
    `INSERT INTO workspace_layout (id, owner_id, name, description, skeleton, origin, source_template_id)
     VALUES ($1, $2, $3, '', $4::jsonb, 'template', $5)
     ON CONFLICT (owner_id, source_template_id) WHERE origin = 'template' AND source_template_id IS NOT NULL
     DO UPDATE SET skeleton = EXCLUDED.skeleton, name = EXCLUDED.name, updated_at = now()
     RETURNING id`,
    [id, ownerId, name, JSON.stringify(skeleton), sourceTemplateId],
  )
  return (await getWorkspaceLayout(rows[0].id))!
}
