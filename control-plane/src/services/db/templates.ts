import { listWorkspaceCommands } from './commands'
import { generateId, pool } from './pool'
import { listSchedulesByWorkspace } from './schedules'
import type { Template, TemplateVersion, TemplateVisibility } from './types'
import { getWorkspaceLayout } from './workspace-layout'
import { getWorkspaceProfile } from './workspace-profile'

/**
 * p3 extension: template_version_skills FKs by skill_id (UUID). Reads project
 * both the id (authoritative reference) and the JOINed `skills.name` (display
 * only — not globally unique). The base `TemplateVersion` type in db/types.ts
 * still exposes `skill_names`, so we extend it locally to surface ids without
 * editing the shared type.
 */
export interface TemplateVersionWithSkills extends TemplateVersion {
  skill_ids: string[]
}

type TemplateMyPermission = 'owner' | 'editor' | 'viewer' | 'public'

interface TemplateSharedTeam {
  id: string
  name: string
  permission: 'viewer' | 'editor'
}

export interface TemplateWithAccess extends Template {
  is_owner: boolean
  my_permission: TemplateMyPermission
  shared_via_teams: TemplateSharedTeam[]
}

interface TemplateGrantInput {
  team_id: string
  permission: 'viewer' | 'editor'
}

interface TemplateGrantRow {
  team_id: string
  team_name: string
  permission: 'viewer' | 'editor'
  granted_at: string
}

/**
 * Templates visible to the user — owned, public, or shared via team grants.
 */
export async function listVisibleToUser(userId: string): Promise<TemplateWithAccess[]> {
  const { rows } = await pool.query(
    `WITH my_grants AS (
       SELECT tg.template_id, tg.team_id, tg.permission, t.name AS team_name
         FROM template_grants tg
         JOIN team_members tm ON tm.team_id = tg.team_id AND tm.user_id = $1
         JOIN teams t ON t.id = tg.team_id
     ),
     visible AS (
       SELECT tpl.id FROM templates tpl WHERE tpl.owner_id = $1
       UNION
       SELECT tpl.id FROM templates tpl WHERE tpl.visibility = 'public'
       UNION
       SELECT template_id FROM my_grants
     )
     SELECT tpl.*,
            u.display_name AS owner_name,
            (tpl.owner_id = $1) AS is_owner,
            COALESCE(
              (SELECT json_agg(json_build_object(
                 'id', mg.team_id,
                 'name', mg.team_name,
                 'permission', mg.permission
               ))
                 FROM my_grants mg WHERE mg.template_id = tpl.id),
              '[]'::json
            ) AS shared_via_teams,
            COALESCE(
              (SELECT MAX(CASE permission WHEN 'editor' THEN 2 WHEN 'viewer' THEN 1 END)
                 FROM my_grants mg WHERE mg.template_id = tpl.id),
              0
            ) AS grant_rank
       FROM templates tpl
       JOIN users u ON u.id = tpl.owner_id
      WHERE tpl.id IN (SELECT id FROM visible)
      ORDER BY tpl.name`,
    [userId],
  )
  return rows.map((r) => decorateTemplate(r, userId))
}

export async function getTemplate(id: string): Promise<Template | null> {
  const { rows } = await pool.query(
    `SELECT t.*, u.display_name AS owner_name
     FROM templates t JOIN users u ON t.owner_id = u.id
     WHERE t.id = $1`,
    [id],
  )
  return (rows[0] as Template) ?? null
}

export async function getTemplateForUser(
  id: string,
  userId: string,
): Promise<TemplateWithAccess | null> {
  const { rows } = await pool.query(
    `WITH my_grants AS (
       SELECT tg.template_id, tg.team_id, tg.permission, t.name AS team_name
         FROM template_grants tg
         JOIN team_members tm ON tm.team_id = tg.team_id AND tm.user_id = $2
         JOIN teams t ON t.id = tg.team_id
        WHERE tg.template_id = $1
     )
     SELECT tpl.*,
            u.display_name AS owner_name,
            (tpl.owner_id = $2) AS is_owner,
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
       FROM templates tpl
       JOIN users u ON u.id = tpl.owner_id
      WHERE tpl.id = $1`,
    [id, userId],
  )
  if (rows.length === 0) return null
  const row = rows[0]
  const isOwner = row.owner_id === userId
  const isPublic = row.visibility === 'public'
  const grantRank = Number(row.grant_rank) || 0
  if (!isOwner && !isPublic && grantRank === 0) return null
  return decorateTemplate(row, userId)
}

function decorateTemplate(
  row: Template & {
    owner_name: string
    is_owner: boolean
    shared_via_teams: TemplateSharedTeam[] | string
    grant_rank: number | string
  },
  userId: string,
): TemplateWithAccess {
  const sharedRaw = row.shared_via_teams
  const shared_via_teams: TemplateSharedTeam[] =
    typeof sharedRaw === 'string' ? JSON.parse(sharedRaw) : sharedRaw
  const grantRank = Number(row.grant_rank) || 0
  const isOwner = row.owner_id === userId
  let my_permission: TemplateMyPermission
  if (isOwner) my_permission = 'owner'
  else if (grantRank === 2) my_permission = 'editor'
  else if (grantRank === 1) my_permission = 'viewer'
  else my_permission = 'public'
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    owner_id: row.owner_id,
    owner_name: row.owner_name,
    visibility: row.visibility,
    latest_version: row.latest_version,
    created_at: row.created_at,
    updated_at: row.updated_at,
    is_owner: isOwner,
    my_permission,
    shared_via_teams,
  }
}

export async function createTemplate(
  ownerId: string,
  name: string,
  description: string,
  visibility: TemplateVisibility = 'private',
): Promise<Template> {
  const id = generateId()
  await pool.query(
    `INSERT INTO templates (id, name, description, owner_id, visibility)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, name, description, ownerId, visibility],
  )
  return (await getTemplate(id))!
}

export async function updateTemplate(
  id: string,
  updates: Partial<Pick<Template, 'name' | 'description' | 'visibility'>>,
): Promise<Template | null> {
  const sets: string[] = []
  const values: unknown[] = []
  let paramIndex = 1

  const fields = ['name', 'description', 'visibility'] as const
  for (const field of fields) {
    if (updates[field] !== undefined) {
      sets.push(`${field} = $${paramIndex++}`)
      values.push(updates[field])
    }
  }

  if (sets.length === 0) return await getTemplate(id)

  sets.push('updated_at = NOW()')
  values.push(id)
  await pool.query(`UPDATE templates SET ${sets.join(', ')} WHERE id = $${paramIndex}`, values)
  return await getTemplate(id)
}

export async function deleteTemplate(id: string): Promise<boolean> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // A template's layout copies become the recipient's own local layouts. Done
    // before the delete: the FK's ON DELETE SET NULL would otherwise null their
    // source and leave them stuck as uneditable, source-less template rows.
    await client.query(
      "UPDATE workspace_layout SET origin = 'local', source_template_id = NULL WHERE source_template_id = $1",
      [id],
    )
    const result = await client.query('DELETE FROM templates WHERE id = $1', [id])
    await client.query('COMMIT')
    return (result.rowCount ?? 0) > 0
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

/**
 * Subquery that yields the skill_ids and skill_names arrays for a template
 * version, ordered consistently (by skill.name) so the two arrays stay aligned
 * position-by-position. Used by every read path that returns `TemplateVersion`.
 */
const SKILL_PROJECTION_SQL = `
  COALESCE(
    (SELECT array_agg(s.id ORDER BY s.name)
     FROM template_version_skills tvs
     JOIN skills s ON s.id = tvs.skill_id
     WHERE tvs.template_version_id = tv.id),
    ARRAY[]::UUID[]
  )::text[] AS skill_ids,
  COALESCE(
    (SELECT array_agg(s.name ORDER BY s.name)
     FROM template_version_skills tvs
     JOIN skills s ON s.id = tvs.skill_id
     WHERE tvs.template_version_id = tv.id),
    ARRAY[]::TEXT[]
  ) AS skill_names`

/**
 * Subquery yielding the command set a template version distributes, as a JSON
 * array ordered by (sort_order, name). node-postgres parses the json column
 * straight into `TemplateVersion.commands`.
 */
const COMMANDS_PROJECTION_SQL = `
  COALESCE(
    (SELECT json_agg(json_build_object(
       'id', tvc.id,
       'name', tvc.name,
       'type', tvc.type,
       'prompt_id', tvc.prompt_id,
       'content', tvc.content,
       'sort_order', tvc.sort_order
     ) ORDER BY tvc.sort_order, tvc.name)
     FROM template_version_commands tvc
     WHERE tvc.template_version_id = tv.id),
    '[]'::json
  ) AS commands`

/** Subquery yielding the schedule set a template version distributes. */
const SCHEDULES_PROJECTION_SQL = `
  COALESCE(
    (SELECT json_agg(json_build_object(
       'id', tvsch.id,
       'name', tvsch.name,
       'cron', tvsch.cron,
       'timezone', tvsch.timezone,
       'prompt', tvsch.prompt,
       'prompt_id', tvsch.prompt_id,
       'enabled_default', tvsch.enabled_default,
       'sort_order', tvsch.sort_order
     ) ORDER BY tvsch.sort_order, tvsch.name)
     FROM template_version_schedules tvsch
     WHERE tvsch.template_version_id = tv.id),
    '[]'::json
  ) AS schedules`

export async function listTemplateVersions(
  templateId: string,
): Promise<TemplateVersionWithSkills[]> {
  const { rows } = await pool.query(
    `SELECT tv.*, mp.name AS provider_name,
       ${SKILL_PROJECTION_SQL},
       ${COMMANDS_PROJECTION_SQL},
       ${SCHEDULES_PROJECTION_SQL}
     FROM template_versions tv
     LEFT JOIN model_providers mp ON tv.provider_id = mp.id
     WHERE tv.template_id = $1
     ORDER BY tv.version DESC`,
    [templateId],
  )
  return rows as TemplateVersionWithSkills[]
}

export async function getTemplateVersion(
  templateId: string,
  version: number,
): Promise<TemplateVersionWithSkills | null> {
  const { rows } = await pool.query(
    `SELECT tv.*, mp.name AS provider_name,
       ${SKILL_PROJECTION_SQL},
       ${COMMANDS_PROJECTION_SQL},
       ${SCHEDULES_PROJECTION_SQL}
     FROM template_versions tv
     LEFT JOIN model_providers mp ON tv.provider_id = mp.id
     WHERE tv.template_id = $1 AND tv.version = $2`,
    [templateId, version],
  )
  return (rows[0] as TemplateVersionWithSkills) ?? null
}

export async function getLatestTemplateVersion(
  templateId: string,
): Promise<TemplateVersionWithSkills | null> {
  const { rows } = await pool.query('SELECT latest_version FROM templates WHERE id = $1', [
    templateId,
  ])
  if (rows.length === 0 || rows[0].latest_version === 0) return null
  return getTemplateVersion(templateId, rows[0].latest_version)
}

export async function createTemplateVersion(
  templateId: string,
  config: {
    agent_type?: string
    system_prompt?: string
    prompt_id?: string | null
    prompt_version?: number | null
    /** Stored verbatim — text column. Codex stores TOML here, others JSON. */
    mcp_config?: string
    /** Stored verbatim — text column. Codex stores TOML here, others JSON. */
    agent_settings?: string
    compute_resources?: Record<string, unknown>
    provider_id?: string | null
    model?: string
    small_model?: string
    /** p3: skills pinned by UUID. `skill_names` is no longer accepted here. */
    skill_ids?: string[]
    /** Explicit command set, written verbatim into the version. */
    commands?: Array<{
      name: string
      type?: 'plain' | 'struct'
      prompt_id?: string | null
      content?: string
      sort_order?: number
    }>
    /** Explicit schedule set (recurring cron only), written verbatim. */
    schedules?: Array<{
      name: string
      cron: string
      timezone?: string
      prompt?: string
      prompt_id?: string | null
      enabled_default?: boolean
      sort_order?: number
    }>
    /**
     * Snapshot source. With the matching `include_*` flag, the server reads that
     * workspace's effective state into the new version (one-shot read, no
     * persisted binding) and it overrides the explicit field for that category.
     */
    from_workspace_id?: string
    include_commands?: boolean
    include_schedules?: boolean
    include_layout?: boolean
    /** Explicit layout link (escape hatch); resolved from the source ws when snapshotting. */
    layout_id?: string | null
  },
): Promise<TemplateVersionWithSkills> {
  // Resolve the command set to store: explicit `commands`, or a one-shot
  // snapshot of the source workspace's effective (enabled) commands.
  let commandsToWrite = config.commands ?? []
  if (config.from_workspace_id && config.include_commands) {
    const effective = await listWorkspaceCommands(config.from_workspace_id)
    commandsToWrite = effective
      .filter((cmd) => !cmd.disabled)
      .map((cmd) => ({
        name: cmd.name,
        type: cmd.type,
        prompt_id: cmd.prompt_id,
        content: cmd.content,
        sort_order: cmd.sort_order,
      }))
  }

  // Resolve the schedule set: explicit `schedules`, or a snapshot of the source
  // workspace's recurring (cron) schedules. The schedule's current `enabled`
  // becomes the version's `enabled_default`. One-time run_at schedules are
  // never template-eligible.
  let schedulesToWrite = config.schedules ?? []
  if (config.from_workspace_id && config.include_schedules) {
    const ws = await listSchedulesByWorkspace(config.from_workspace_id)
    schedulesToWrite = ws
      .filter((s) => !!s.cron)
      .map((s) => ({
        name: s.name,
        cron: s.cron as string,
        timezone: s.timezone,
        prompt: s.prompt,
        prompt_id: s.prompt_id,
        enabled_default: s.enabled,
        sort_order: 0,
      }))
  }

  // Resolve which layout row this version ships. A template references the
  // builder's selected layout (a link); create/sync resolve + copy its current
  // skeleton into a recipient-owned row. Snapshot path reads the source ws's
  // `selected_layout_id`; a dangling/absent selection ships no layout.
  let layoutIdToWrite: string | null = config.layout_id ?? null
  if (config.from_workspace_id && config.include_layout) {
    const profile = await getWorkspaceProfile(config.from_workspace_id)
    const sel = typeof profile.selected_layout_id === 'string' ? profile.selected_layout_id : null
    layoutIdToWrite = sel && (await getWorkspaceLayout(sel)) ? sel : null
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows } = await client.query(
      'SELECT latest_version FROM templates WHERE id = $1 FOR UPDATE',
      [templateId],
    )
    if (rows.length === 0) throw new Error('Template not found')

    const newVersion = rows[0].latest_version + 1
    const id = generateId()

    await client.query(
      `INSERT INTO template_versions (id, template_id, version, agent_type, system_prompt, prompt_id, prompt_version, mcp_config, agent_settings, compute_resources, provider_id, model, small_model, layout_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        id,
        templateId,
        newVersion,
        config.agent_type || 'claude-agent-sdk',
        config.system_prompt || '',
        config.prompt_id ?? null,
        config.prompt_version ?? null,
        config.mcp_config ?? '{}',
        config.agent_settings ?? '{}',
        JSON.stringify(config.compute_resources || {}),
        config.provider_id ?? null,
        config.model || '',
        config.small_model || '',
        layoutIdToWrite,
      ],
    )

    if (config.skill_ids && config.skill_ids.length > 0) {
      for (const skillId of config.skill_ids) {
        await client.query(
          'INSERT INTO template_version_skills (template_version_id, skill_id) VALUES ($1, $2)',
          [id, skillId],
        )
      }
    }

    for (const cmd of commandsToWrite) {
      await client.query(
        `INSERT INTO template_version_commands (template_version_id, name, type, prompt_id, content, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          id,
          cmd.name,
          cmd.type ?? 'plain',
          cmd.prompt_id ?? null,
          cmd.content ?? '',
          cmd.sort_order ?? 0,
        ],
      )
    }

    for (const s of schedulesToWrite) {
      await client.query(
        `INSERT INTO template_version_schedules (template_version_id, name, cron, timezone, prompt, prompt_id, enabled_default, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          id,
          s.name,
          s.cron,
          s.timezone ?? 'UTC',
          s.prompt ?? '',
          s.prompt_id ?? null,
          s.enabled_default ?? false,
          s.sort_order ?? 0,
        ],
      )
    }

    await client.query(
      'UPDATE templates SET latest_version = $1, updated_at = NOW() WHERE id = $2',
      [newVersion, templateId],
    )

    await client.query('COMMIT')
    return (await getTemplateVersion(templateId, newVersion))!
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

// ── Grants ──

export async function listTemplateGrants(templateId: string): Promise<TemplateGrantRow[]> {
  const { rows } = await pool.query(
    `SELECT tg.team_id, t.name AS team_name, tg.permission, tg.granted_at
       FROM template_grants tg
       JOIN teams t ON t.id = tg.team_id
      WHERE tg.template_id = $1
      ORDER BY tg.granted_at ASC`,
    [templateId],
  )
  return rows as TemplateGrantRow[]
}

export async function setTemplateGrants(
  templateId: string,
  grants: TemplateGrantInput[],
  grantedBy: string,
): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (grants.length === 0) {
      await client.query('DELETE FROM template_grants WHERE template_id = $1', [templateId])
    } else {
      const teamIds = grants.map((g) => g.team_id)
      await client.query(
        'DELETE FROM template_grants WHERE template_id = $1 AND team_id <> ALL($2::text[])',
        [templateId, teamIds],
      )
      for (const g of grants) {
        await client.query(
          `INSERT INTO template_grants (template_id, team_id, permission, granted_by)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (template_id, team_id)
           DO UPDATE SET permission = EXCLUDED.permission, granted_by = EXCLUDED.granted_by`,
          [templateId, g.team_id, g.permission, grantedBy],
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
