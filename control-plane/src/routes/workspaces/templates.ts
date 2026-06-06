import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { ApiTemplateSchema } from '../../../../internal/types/api'
import type { AppEnv } from '../../lib/types'
import { notifyAgentReload } from '../../lib/workspace-address'
import {
  createTemplate,
  createTemplateVersion,
  getTemplate,
  getTemplateForUser,
  getTemplateVersion,
} from '../../services/db/templates'
import {
  getWorkspace,
  getWorkspaceConfig,
  updateWorkspaceConfig,
} from '../../services/db/workspaces'
import { skillRepo } from '../../services/skills-composition'
import { reconcileTemplateLayout } from '../../services/template-layout'
import { reconcileTemplateSchedules } from '../../services/template-schedules'
import { canManage } from './_shared'

const templates = new OpenAPIHono<AppEnv>()

const ErrorSchema = z.object({ error: z.string() })

const WorkspaceIdParam = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' } }),
})

// ── POST /:id/save-as-template ─────────────────────────────────────────────
const SaveAsTemplateBodySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  /** When true (default), bind the workspace to the newly created template. */
  bind: z.boolean().optional(),
  /** Snapshot the workspace's commands into the template (default true). */
  include_commands: z.boolean().optional(),
  /** Snapshot the workspace's recurring schedules into the template (default true). */
  include_schedules: z.boolean().optional(),
  /** Reference the workspace's selected layout from the template (default true). */
  include_layout: z.boolean().optional(),
})

const saveAsTemplateRoute = createRoute({
  method: 'post',
  path: '/{id}/save-as-template',
  tags: ['workspaces'],
  summary: 'Snapshot a workspace into a new template',
  security: [{ bearerAuth: [] }],
  request: {
    params: WorkspaceIdParam,
    body: { content: { 'application/json': { schema: SaveAsTemplateBodySchema } } },
  },
  responses: {
    201: {
      description: 'Template created',
      content: { 'application/json': { schema: ApiTemplateSchema } },
    },
    400: { description: 'Invalid input', content: { 'application/json': { schema: ErrorSchema } } },
    404: {
      description: 'Workspace or config not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

templates.openapi(saveAsTemplateRoute, async (c) => {
  const currentUser = c.get('user')
  const { id } = c.req.valid('param')
  const body = c.req.valid('json')

  const workspace = await getWorkspace(id)
  if (!workspace || !canManage(workspace, currentUser)) {
    return c.json({ error: 'Workspace not found' }, 404)
  }

  const config = await getWorkspaceConfig(id)
  if (!config) {
    return c.json({ error: 'Workspace config not found' }, 404)
  }

  const skillIds = await skillRepo.getWorkspaceSkillIds(id)

  const template = await createTemplate(
    currentUser.sub,
    body.name.trim(),
    body.description?.trim() || '',
  )
  await createTemplateVersion(template.id, {
    agent_type: config.agent_type,
    system_prompt: config.system_prompt,
    prompt_id: config.prompt_id,
    mcp_config: config.mcp_config ?? '{}',
    agent_settings: config.agent_settings ?? '{}',
    compute_resources: config.compute_resources ?? {},
    provider_id: config.provider_id,
    model: config.model,
    small_model: config.small_model,
    skill_ids: skillIds,
    from_workspace_id: id,
    include_commands: body.include_commands ?? true,
    include_schedules: body.include_schedules ?? true,
    include_layout: body.include_layout ?? true,
  })

  if (body.bind !== false) {
    await updateWorkspaceConfig(id, { template_id: template.id, template_version: 1 })
    if (skillIds.length > 0) {
      await skillRepo.setWorkspaceSkills(id, skillIds)
    }
  }

  const created = (await getTemplateForUser(template.id, currentUser.sub))!
  return c.json(
    {
      id: created.id,
      name: created.name,
      description: created.description,
      owner_id: created.owner_id,
      owner_name: created.owner_name,
      is_owner: created.is_owner,
      visibility: created.visibility,
      my_permission: created.my_permission,
      shared_via_teams: created.shared_via_teams,
      latest_version: created.latest_version,
      created_at: created.created_at,
      updated_at: created.updated_at,
    },
    201,
  )
})

// ── POST /:id/sync-template ────────────────────────────────────────────────
const SyncTemplateResponseSchema = z.object({
  success: z.boolean(),
  version: z.number().int(),
  reloaded: z.boolean().optional(),
})

// Optional body: recipient consent for schedules newly introduced by the
// version being synced to (name \u2192 enabled). Absent \u2192 each new schedule's
// enabled_default. Existing template schedules keep the user's current toggle.
const SyncTemplateBodySchema = z.object({
  schedule_overrides: z.record(z.string(), z.boolean()).optional(),
})

const syncTemplateRoute = createRoute({
  method: 'post',
  path: '/{id}/sync-template',
  tags: ['workspaces'],
  summary: 'Sync a workspace to its bound template\u2019s latest version',
  security: [{ bearerAuth: [] }],
  request: {
    params: WorkspaceIdParam,
    body: {
      required: false,
      content: { 'application/json': { schema: SyncTemplateBodySchema } },
    },
  },
  responses: {
    200: {
      description: 'Synced',
      content: { 'application/json': { schema: SyncTemplateResponseSchema } },
    },
    400: {
      description: 'Workspace is not bound to a template, or is already at latest version',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    403: {
      description: 'Latest template version uses skills not visible to the user',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Workspace or template not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

templates.openapi(syncTemplateRoute, async (c) => {
  const currentUser = c.get('user')
  const { id } = c.req.valid('param')

  const workspace = await getWorkspace(id)
  if (!workspace || !canManage(workspace, currentUser)) {
    return c.json({ error: 'Workspace not found' }, 404)
  }

  const config = await getWorkspaceConfig(id)
  if (!config?.template_id) {
    return c.json({ error: 'Workspace is not using a template' }, 400)
  }

  const template = await getTemplate(config.template_id)
  if (!template) {
    return c.json({ error: 'Template not found' }, 404)
  }

  if (config.template_version === template.latest_version) {
    return c.json({ error: 'Already at latest version' }, 400)
  }

  const latestVersion = await getTemplateVersion(config.template_id, template.latest_version)
  if (latestVersion && latestVersion.skill_ids.length > 0) {
    // Sync may pull in skills the workspace owner doesn't currently see (template
    // owner could have included a private skill that's not shared). Refuse — owner
    // should re-share or remove the skill from the template version first.
    const notVisible = await skillRepo.findSkillIdsNotVisibleToUser(
      latestVersion.skill_ids,
      workspace.user_id,
    )
    if (notVisible.length > 0) {
      return c.json(
        {
          error: `Latest template version uses skills not visible to you: ${notVisible.join(', ')}`,
        },
        403,
      )
    }
  }

  await updateWorkspaceConfig(id, { template_version: template.latest_version })

  if (latestVersion) {
    await skillRepo.setWorkspaceSkills(id, latestVersion.skill_ids)
  }

  // Reconcile template schedules by name: add new, drop removed, refresh changed
  // definitions while preserving the user's enable/disable toggle.
  await reconcileTemplateSchedules({
    workspaceId: id,
    userId: workspace.user_id,
    templateId: config.template_id,
    version: template.latest_version,
    enabledOverrides: c.req.valid('json')?.schedule_overrides,
  })

  // Refresh the template-origin layout copy; auto-adopt for pristine workspaces.
  await reconcileTemplateLayout({
    workspaceId: id,
    userId: workspace.user_id,
    templateId: config.template_id,
    version: template.latest_version,
  })

  const reloaded =
    workspace.status === 'running' ? await notifyAgentReload(workspace.id, ['config']) : false

  return c.json({ success: true, version: template.latest_version, reloaded }, 200)
})

export default templates
