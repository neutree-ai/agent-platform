import { pool } from './pool'
import type { WorkspaceCommand } from './types'

const WORKSPACE_COMMAND_SELECT = `
  SELECT wc.*, p.content AS prompt_content
  FROM workspace_commands wc
  LEFT JOIN prompts p ON wc.prompt_id = p.id
`

export async function createWorkspaceCommand(data: {
  workspace_id: string
  user_id: string
  name: string
  type: 'plain' | 'struct'
  prompt_id?: string | null
  content?: string
  sort_order?: number
}): Promise<WorkspaceCommand> {
  const { rows } = await pool.query(
    `INSERT INTO workspace_commands (workspace_id, user_id, name, type, prompt_id, content, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [
      data.workspace_id,
      data.user_id,
      data.name,
      data.type,
      data.prompt_id ?? null,
      data.content ?? '',
      data.sort_order ?? 0,
    ],
  )
  return (await getWorkspaceCommand(rows[0].id))!
}

export async function getWorkspaceCommand(id: string): Promise<WorkspaceCommand | null> {
  const { rows } = await pool.query(`${WORKSPACE_COMMAND_SELECT} WHERE wc.id = $1`, [id])
  return rows[0] ?? null
}

/** A resolved command: a workspace-local row, or a template base command. */
export interface ResolvedWorkspaceCommand extends WorkspaceCommand {
  source: 'local' | 'template'
}

/**
 * The effective command set for a workspace — read-time layering of the bound
 * template version's base commands and the workspace's own rows:
 *   (template base)  minus (names the user disabled)  minus (names shadowed by
 *   a local command)  plus (the workspace's local commands).
 * Local wins on name collision. Disabled commands are still returned (flagged)
 * so the management UI can render a re-enable toggle; runtime/palette consumers
 * must filter on `disabled`.
 */
export async function listWorkspaceCommands(
  workspaceId: string,
): Promise<ResolvedWorkspaceCommand[]> {
  const { rows: wsRows } = await pool.query<WorkspaceCommand>(
    `${WORKSPACE_COMMAND_SELECT} WHERE wc.workspace_id = $1`,
    [workspaceId],
  )
  const localCommands = wsRows.filter((r) => r.origin === 'local')
  const localNames = new Set(localCommands.map((r) => r.name))
  const disabledTemplateNames = new Set(
    wsRows.filter((r) => r.origin === 'template' && r.disabled).map((r) => r.name),
  )

  const resolved: ResolvedWorkspaceCommand[] = []

  const { rows: cfgRows } = await pool.query<{
    template_id: string | null
    template_version: number | null
  }>('SELECT template_id, template_version FROM workspace_config WHERE workspace_id = $1', [
    workspaceId,
  ])
  const cfg = cfgRows[0]

  if (cfg?.template_id && cfg.template_version != null) {
    const { rows: baseRows } = await pool.query<{
      id: string
      name: string
      type: 'plain' | 'struct'
      prompt_id: string | null
      prompt_content: string | null
      content: string
      sort_order: number
      created_at: string
    }>(
      `SELECT tvc.id, tvc.name, tvc.type, tvc.prompt_id, p.content AS prompt_content,
              tvc.content, tvc.sort_order, tvc.created_at
         FROM template_version_commands tvc
         JOIN template_versions tv ON tv.id = tvc.template_version_id
         LEFT JOIN prompts p ON tvc.prompt_id = p.id
        WHERE tv.template_id = $1 AND tv.version = $2`,
      [cfg.template_id, cfg.template_version],
    )
    for (const b of baseRows) {
      if (localNames.has(b.name)) continue // local command shadows the base
      resolved.push({
        id: b.id,
        workspace_id: workspaceId,
        user_id: '',
        name: b.name,
        type: b.type,
        prompt_id: b.prompt_id,
        prompt_content: b.prompt_content,
        content: b.content,
        sort_order: b.sort_order,
        origin: 'template',
        disabled: disabledTemplateNames.has(b.name),
        created_at: b.created_at,
        updated_at: b.created_at,
        source: 'template',
      })
    }
  }

  for (const l of localCommands) {
    resolved.push({ ...l, source: 'local' })
  }

  resolved.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
  return resolved
}

/**
 * Enable/disable a template-provided command for a workspace. Disabling upserts
 * a marker row (origin='template'); enabling removes it so the command falls
 * back to the template base. The DO UPDATE is guarded so it never converts a
 * user's local command of the same name into a marker.
 */
export async function setTemplateCommandDisabled(
  workspaceId: string,
  userId: string,
  name: string,
  disabled: boolean,
): Promise<void> {
  if (!disabled) {
    await pool.query(
      `DELETE FROM workspace_commands WHERE workspace_id = $1 AND name = $2 AND origin = 'template'`,
      [workspaceId, name],
    )
    return
  }
  await pool.query(
    `INSERT INTO workspace_commands (workspace_id, user_id, name, origin, disabled, content)
     VALUES ($1, $2, $3, 'template', true, '')
     ON CONFLICT (workspace_id, name)
     DO UPDATE SET disabled = true, updated_at = NOW()
       WHERE workspace_commands.origin = 'template'`,
    [workspaceId, userId, name],
  )
}

export async function updateWorkspaceCommand(
  id: string,
  updates: Partial<
    Pick<WorkspaceCommand, 'name' | 'type' | 'prompt_id' | 'content' | 'sort_order' | 'disabled'>
  >,
): Promise<WorkspaceCommand | null> {
  const sets: string[] = []
  const values: unknown[] = []
  let idx = 1

  for (const field of ['name', 'type', 'prompt_id', 'content', 'sort_order', 'disabled'] as const) {
    if (updates[field] !== undefined) {
      sets.push(`${field} = $${idx++}`)
      values.push(updates[field])
    }
  }

  if (sets.length === 0) return await getWorkspaceCommand(id)

  sets.push('updated_at = NOW()')
  values.push(id)
  await pool.query(`UPDATE workspace_commands SET ${sets.join(', ')} WHERE id = $${idx}`, values)
  return await getWorkspaceCommand(id)
}

export async function deleteWorkspaceCommand(id: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM workspace_commands WHERE id = $1', [id])
  return (result.rowCount ?? 0) > 0
}
