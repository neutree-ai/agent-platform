import { generateId, pool } from './pool'
import type { Workspace, WorkspaceConfig, WorkspaceWithSessionCounts } from './types'

export async function createWorkspace(
  userId: string,
  name: string,
  agentType = 'claude-code',
  isSystem = false,
  opts: { seedDefaultPrompt?: boolean } = {},
): Promise<Workspace> {
  const { seedDefaultPrompt = true } = opts
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const id = generateId()
    await client.query(
      'INSERT INTO workspaces (id, user_id, name, is_system) VALUES ($1, $2, $3, $4)',
      [id, userId, name, isSystem],
    )

    // Resolve default system prompt from user's default prompt (if set).
    // Skipped for template-created workspaces: config resolution prefers
    // workspace-level values, so a seeded default would shadow the
    // template's prompt (or fill in one the template deliberately left
    // empty).
    const { rows: dpRows } = seedDefaultPrompt
      ? await client.query(
          `SELECT p.id, p.content FROM users u
           LEFT JOIN prompts p ON u.default_prompt_id = p.id
           WHERE u.id = $1`,
          [userId],
        )
      : { rows: [] }
    const defaultPrompt = dpRows[0]?.id ? dpRows[0] : null
    const promptId = defaultPrompt ? defaultPrompt.id : null

    await client.query(
      `INSERT INTO workspace_config (workspace_id, agent_type, provider_type, model, small_model, system_prompt, prompt_id, mcp_config, agent_settings, compute_resources)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [id, agentType, '', '', '', defaultPrompt?.content ?? '', promptId, '{}', '{}', '{}'],
    )
    await client.query('COMMIT')
    return (await getWorkspace(id))!
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

export async function getWorkspace(id: string): Promise<Workspace | null> {
  const { rows } = await pool.query('SELECT * FROM workspaces WHERE id = $1', [id])
  return (rows[0] as Workspace) ?? null
}

export async function listWorkspaces(
  userId: string,
  opts?: { search?: string; limit?: number; includeSystem?: boolean },
): Promise<WorkspaceWithSessionCounts[]> {
  const conditions: string[] = opts?.includeSystem
    ? ['(w.user_id = $1 OR w.is_system = true)']
    : ['w.user_id = $1', 'w.is_system = false']
  const values: any[] = [userId]
  let paramIndex = 2

  if (opts?.search) {
    conditions.push(`w.name ILIKE $${paramIndex++}`)
    values.push(`%${opts.search}%`)
  }

  const limit = opts?.limit ?? 50
  values.push(limit)

  const { rows } = await pool.query(
    `SELECT w.*,
       COALESCE(sa.agent_count, 0)::int AS active_agent_sessions,
       COALESCE(sa.human_count, 0)::int AS active_human_sessions,
       COALESCE(sa.details, '[]'::json) AS active_sessions
     FROM workspaces w
     LEFT JOIN LATERAL (
       SELECT
         COUNT(*) FILTER (WHERE s.chat_status = 'agent') AS agent_count,
         COUNT(*) FILTER (WHERE s.chat_status = 'human') AS human_count,
         MAX(s.last_active_at) AS last_active_at,
         json_agg(json_build_object(
           'id', s.id,
           'chat_status', s.chat_status,
           'name', s.name,
           'preview', COALESCE((
             SELECT LEFT(m.content, 40) FROM messages m
             WHERE m.session_id = s.id AND m.role = 'user'
             ORDER BY m.created_at ASC LIMIT 1
           ), '')
         ) ORDER BY s.last_active_at DESC) FILTER (WHERE s.chat_status IN ('agent', 'human')) AS details
       FROM sessions s
       WHERE s.workspace_id = w.id AND s.status = 'active'
     ) sa ON true
     WHERE ${conditions.join(' AND ')}
     ORDER BY CASE w.status WHEN 'running' THEN 0 WHEN 'starting' THEN 1 WHEN 'stopped' THEN 3 ELSE 2 END,
       sa.last_active_at DESC NULLS LAST, w.created_at DESC
     LIMIT $${paramIndex}`,
    values,
  )
  return rows as WorkspaceWithSessionCounts[]
}

export async function updateWorkspace(
  id: string,
  updates: Partial<Pick<Workspace, 'name' | 'slug' | 'visibility' | 'status' | 'runtime_version'>>,
): Promise<boolean> {
  const sets: string[] = []
  const values: any[] = []
  let paramIndex = 1

  if (updates.name !== undefined) {
    sets.push(`name = $${paramIndex++}`)
    values.push(updates.name)
  }
  if (updates.slug !== undefined) {
    sets.push(`slug = $${paramIndex++}`)
    values.push(updates.slug)
  }
  if (updates.visibility !== undefined) {
    sets.push(`visibility = $${paramIndex++}`)
    values.push(updates.visibility)
  }
  if (updates.status !== undefined) {
    sets.push(`status = $${paramIndex++}`)
    values.push(updates.status)
  }
  if (updates.runtime_version !== undefined) {
    sets.push(`runtime_version = $${paramIndex++}`)
    values.push(updates.runtime_version)
  }

  if (sets.length === 0) return false

  values.push(id)
  const result = await pool.query(
    `UPDATE workspaces SET ${sets.join(', ')} WHERE id = $${paramIndex}`,
    values,
  )
  return (result.rowCount ?? 0) > 0
}

export async function markSessionSeen(workspaceId: string, sessionId: string): Promise<boolean> {
  const result = await pool.query(
    "UPDATE sessions SET chat_status = 'idle' WHERE id = $1 AND workspace_id = $2 AND chat_status = 'human'",
    [sessionId, workspaceId],
  )
  return (result.rowCount ?? 0) > 0
}

export async function markAllSessionsSeen(workspaceId: string): Promise<number> {
  const result = await pool.query(
    "UPDATE sessions SET chat_status = 'idle' WHERE workspace_id = $1 AND chat_status = 'human'",
    [workspaceId],
  )
  return result.rowCount ?? 0
}

export async function listAllWorkspaces(): Promise<Workspace[]> {
  const { rows } = await pool.query('SELECT * FROM workspaces')
  return rows as Workspace[]
}

/** Running workspaces with their owner, for the usage sweep (one query, no per-ws lookups). */
export async function listRunningWorkspaces(): Promise<Array<{ id: string; user_id: string }>> {
  const { rows } = await pool.query("SELECT id, user_id FROM workspaces WHERE status = 'running'")
  return rows as Array<{ id: string; user_id: string }>
}

interface IdleWorkspace {
  id: string
  name: string
  /** Most recent activity timestamp — see listIdleRunningWorkspaces. */
  last_used: string
}

/**
 * Running, non-system workspaces with no activity for `idleDays` days. A
 * workspace's "last used" is the latest of: any session's last_active_at, any
 * message's created_at, and the workspace's own created_at (the fallback for a
 * workspace created but never chatted). System workspaces are excluded — they
 * are platform infrastructure and must not be GC'd. Ordered oldest-idle first.
 */
export async function listIdleRunningWorkspaces(idleDays: number): Promise<IdleWorkspace[]> {
  const { rows } = await pool.query(
    `WITH activity AS (
       SELECT w.id, w.name,
         GREATEST(
           w.created_at,
           COALESCE(
             (SELECT MAX(s.last_active_at) FROM sessions s WHERE s.workspace_id = w.id),
             'epoch'::timestamptz
           ),
           COALESCE(
             (SELECT MAX(m.created_at) FROM messages m WHERE m.workspace_id = w.id),
             'epoch'::timestamptz
           )
         ) AS last_used
       FROM workspaces w
       WHERE w.status = 'running' AND w.is_system = false
     )
     SELECT id, name, last_used FROM activity
     WHERE last_used < NOW() - make_interval(days => $1::int)
     ORDER BY last_used ASC`,
    [idleDays],
  )
  return rows as IdleWorkspace[]
}

export async function resolveWorkspaceBySlug(
  slugRef: string,
  callerUserId: string,
): Promise<Workspace | null> {
  const slashIdx = slugRef.indexOf('/')
  if (slashIdx >= 0) {
    const username = slugRef.slice(0, slashIdx)
    const slug = slugRef.slice(slashIdx + 1)
    const { rows } = await pool.query(
      `SELECT w.* FROM workspaces w
       JOIN users u ON w.user_id = u.id
       WHERE w.slug = $1 AND u.username = $2 AND w.visibility = 'public'
       LIMIT 1`,
      [slug, username],
    )
    return (rows[0] as Workspace) ?? null
  }

  const { rows } = await pool.query(
    `SELECT * FROM workspaces
     WHERE slug = $1 AND user_id = $2 AND visibility IN ('user', 'public')
     LIMIT 1`,
    [slugRef, callerUserId],
  )
  return (rows[0] as Workspace) ?? null
}

export async function listCallableWorkspaces(
  callerUserId: string,
): Promise<(Workspace & { owner_name: string })[]> {
  const { rows } = await pool.query(
    `SELECT w.*, u.username AS owner_name FROM workspaces w
     JOIN users u ON w.user_id = u.id
     WHERE w.slug IS NOT NULL AND (
       (w.user_id = $1 AND w.visibility IN ('user', 'public'))
       OR (w.user_id != $1 AND w.visibility = 'public')
     )
     ORDER BY w.user_id = $1 DESC, w.name ASC`,
    [callerUserId],
  )
  return rows as (Workspace & { owner_name: string })[]
}

export async function deleteWorkspace(id: string): Promise<boolean> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM messages WHERE workspace_id = $1', [id])
    await client.query('DELETE FROM sessions WHERE workspace_id = $1', [id])
    await client.query('DELETE FROM workspace_config WHERE workspace_id = $1', [id])
    await client.query('DELETE FROM workspace_skills WHERE workspace_id = $1', [id])
    await client.query('DELETE FROM workspace_tag_assignments WHERE workspace_id = $1', [id])
    // Pure pull-optimization state; the usage *ledger* is immutable and intentionally kept.
    await client.query('DELETE FROM workspace_usage_cursor WHERE workspace_id = $1', [id])
    await client.query('DELETE FROM shares WHERE workspace_id = $1', [id])
    const result = await client.query('DELETE FROM workspaces WHERE id = $1', [id])
    await client.query('COMMIT')
    return (result.rowCount ?? 0) > 0
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

export async function listSystemWorkspaces(): Promise<Workspace[]> {
  const { rows } = await pool.query('SELECT * FROM workspaces WHERE is_system = true ORDER BY name')
  return rows as Workspace[]
}

export async function getWorkspaceConfig(workspaceId: string): Promise<WorkspaceConfig | null> {
  const { rows } = await pool.query(
    `SELECT wc.workspace_id,
       CASE WHEN wc.template_id IS NOT NULL THEN COALESCE(wc.provider_id, tv.provider_id)
            ELSE wc.provider_id END AS provider_id,
       wc.template_id, wc.template_version,
       CASE WHEN wc.template_id IS NOT NULL THEN COALESCE(NULLIF(wc.agent_type, ''), tv.agent_type)
            ELSE wc.agent_type END AS agent_type,
       CASE WHEN wc.template_id IS NOT NULL THEN COALESCE(NULLIF(wp.provider_type, ''), tp.provider_type, wc.provider_type)
            WHEN wc.provider_id IS NOT NULL THEN COALESCE(NULLIF(wp.provider_type, ''), wc.provider_type)
            ELSE wc.provider_type END AS provider_type,
       CASE WHEN wc.template_id IS NOT NULL THEN COALESCE(NULLIF(wp.base_url, ''), tp.base_url, wc.base_url)
            WHEN wc.provider_id IS NOT NULL THEN COALESCE(NULLIF(wp.base_url, ''), wc.base_url)
            ELSE wc.base_url END AS base_url,
       CASE WHEN wc.template_id IS NOT NULL THEN COALESCE(NULLIF(wp.api_key, ''), tp.api_key, wc.api_key)
            WHEN wc.provider_id IS NOT NULL THEN COALESCE(NULLIF(wp.api_key, ''), wc.api_key)
            ELSE wc.api_key END AS api_key,
       CASE WHEN wc.template_id IS NOT NULL THEN COALESCE(NULLIF(wc.model, ''), tv.model)
            ELSE wc.model END AS model,
       CASE WHEN wc.template_id IS NOT NULL THEN COALESCE(NULLIF(wc.small_model, ''), tv.small_model)
            ELSE wc.small_model END AS small_model,
       CASE WHEN wc.template_id IS NOT NULL THEN COALESCE(NULLIF(wc.system_prompt, ''), tv.system_prompt)
            ELSE wc.system_prompt END AS system_prompt,
       CASE WHEN wc.template_id IS NOT NULL THEN COALESCE(NULLIF(wc.mcp_config, '{}'), tv.mcp_config::text)
            ELSE wc.mcp_config END AS mcp_config,
       CASE WHEN wc.template_id IS NOT NULL THEN COALESCE(NULLIF(wc.agent_settings, '{}'), tv.agent_settings::text)
            ELSE wc.agent_settings END AS agent_settings,
       CASE WHEN wc.template_id IS NOT NULL THEN COALESCE(wc.compute_resources, tv.compute_resources)
            ELSE wc.compute_resources END AS compute_resources,
       wc.auto_start,
       wc.updated_at,
       CASE WHEN wc.template_id IS NOT NULL
            THEN CASE WHEN wc.prompt_id IS NOT NULL THEN wc.prompt_id
                      WHEN COALESCE(wc.system_prompt, '') <> '' THEN NULL
                      ELSE tv.prompt_id END
            ELSE wc.prompt_id END AS prompt_id,
       CASE WHEN wc.prompt_id IS NOT NULL THEN pr.name
            WHEN wc.template_id IS NOT NULL AND COALESCE(wc.system_prompt, '') = '' THEN tpr.name
            ELSE NULL END AS prompt_name,
       CASE WHEN wc.prompt_id IS NOT NULL THEN pr.content
            WHEN wc.template_id IS NOT NULL AND COALESCE(wc.system_prompt, '') = '' THEN COALESCE(tpv.content, tpr.content)
            ELSE NULL END AS prompt_content,
       t.name AS template_name,
       t.latest_version AS template_latest_version
     FROM workspace_config wc
     LEFT JOIN model_providers wp ON wc.provider_id = wp.id
     LEFT JOIN prompts pr ON wc.prompt_id = pr.id
     LEFT JOIN template_versions tv ON wc.template_id = tv.template_id AND wc.template_version = tv.version
     LEFT JOIN templates t ON wc.template_id = t.id
     LEFT JOIN model_providers tp ON tv.provider_id = tp.id
     LEFT JOIN prompts tpr ON tv.prompt_id = tpr.id
     LEFT JOIN prompt_versions tpv ON tv.prompt_id = tpv.prompt_id AND tv.prompt_version = tpv.version
     WHERE wc.workspace_id = $1`,
    [workspaceId],
  )
  return (rows[0] as WorkspaceConfig) ?? null
}

export async function updateWorkspaceConfig(
  workspaceId: string,
  updates: Partial<
    Omit<
      WorkspaceConfig,
      | 'workspace_id'
      | 'updated_at'
      | 'prompt_name'
      | 'prompt_content'
      | 'template_name'
      | 'template_latest_version'
    >
  >,
): Promise<void> {
  const sets: string[] = []
  const values: any[] = []
  let paramIndex = 1

  const fields = [
    'provider_id',
    'prompt_id',
    'agent_type',
    'provider_type',
    'model',
    'base_url',
    'api_key',
    'small_model',
    'system_prompt',
    'mcp_config',
    'agent_settings',
    'compute_resources',
    'auto_start',
    'template_id',
    'template_version',
  ] as const
  for (const field of fields) {
    if (updates[field] !== undefined) {
      sets.push(`${field} = $${paramIndex++}`)
      values.push(field === 'compute_resources' ? JSON.stringify(updates[field]) : updates[field])
    }
  }

  if (sets.length === 0) return

  sets.push('updated_at = NOW()')
  values.push(workspaceId)
  await pool.query(
    `UPDATE workspace_config SET ${sets.join(', ')} WHERE workspace_id = $${paramIndex}`,
    values,
  )
}

export async function listWorkspacesUsingPrompt(
  promptId: string,
  runningOnly = false,
): Promise<Workspace[]> {
  const statusFilter = runningOnly ? " AND w.status = 'running'" : ''
  const { rows } = await pool.query(
    `SELECT DISTINCT w.* FROM workspaces w
     WHERE (
       EXISTS (
         SELECT 1 FROM workspace_config wc
         LEFT JOIN template_versions tv ON wc.template_id = tv.template_id AND wc.template_version = tv.version
         WHERE wc.workspace_id = w.id AND (wc.prompt_id = $1 OR tv.prompt_id = $1)
       )
       OR EXISTS (SELECT 1 FROM schedules s WHERE s.workspace_id = w.id AND s.prompt_id = $1)
       OR EXISTS (SELECT 1 FROM workspace_commands c WHERE c.workspace_id = w.id AND c.prompt_id = $1)
     )${statusFilter}`,
    [promptId],
  )
  return rows as Workspace[]
}

export async function listWorkspacesUsingTemplate(templateId: string): Promise<Workspace[]> {
  const { rows } = await pool.query(
    `SELECT DISTINCT w.* FROM workspaces w
     JOIN workspace_config wc ON w.id = wc.workspace_id
     WHERE wc.template_id = $1`,
    [templateId],
  )
  return rows as Workspace[]
}

// listWorkspacesUsingSkill / countNonOwnerWorkspacesUsingSkill moved into
// PgSkillRepository alongside the rest of the skills SQL surface.
