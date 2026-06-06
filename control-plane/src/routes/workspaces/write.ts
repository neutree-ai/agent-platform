import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  ApiWorkspaceConfigSchema,
  ApiWorkspaceSchema,
  WorkspaceCreateBodySchema,
  WorkspacePatchBodySchema,
} from '../../../../internal/types/api'
import * as jobs from '../../lib/jobs'
import { fireDeleteHooks } from '../../lib/service-hooks'
import type { AppEnv } from '../../lib/types'
import { getWorkspaceAddress } from '../../lib/workspace-address'
import { attachStore, createStore } from '../../services/db/memory'
import { listSchedulesByWorkspace } from '../../services/db/schedules'
import { listActiveSessionIds } from '../../services/db/sessions'
import { getTemplateForUser, getTemplateVersion } from '../../services/db/templates'
import {
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  getWorkspaceConfig,
  updateWorkspace,
  updateWorkspaceConfig,
} from '../../services/db/workspaces'
import * as k8s from '../../services/k8s'
import { isMemoryFuseAvailable } from '../../services/k8s'
import { skillRepo } from '../../services/skills-composition'
import { materializeTemplateLayout } from '../../services/template-layout'
import { materializeTemplateSchedules } from '../../services/template-schedules'
import { applyWorkspaceConfigUpdate } from '../../services/workspace-config'
import { canManage, toApiWorkspace } from './_shared'

const write = new OpenAPIHono<AppEnv>()

const ErrorSchema = z.object({ error: z.string() })
const SuccessSchema = z.object({ success: z.boolean() })

const WorkspaceIdParam = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' } }),
})

// ── POST / ─────────────────────────────────────────────────────────────────
const createRouteDef = createRoute({
  method: 'post',
  path: '/',
  tags: ['workspaces'],
  summary: 'Create a workspace',
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { 'application/json': { schema: WorkspaceCreateBodySchema } } },
  },
  responses: {
    201: {
      description: 'Created workspace',
      content: { 'application/json': { schema: ApiWorkspaceSchema } },
    },
    400: { description: 'Invalid input', content: { 'application/json': { schema: ErrorSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorSchema } } },
    404: {
      description: 'Template not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    500: {
      description: 'Internal error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

write.openapi(createRouteDef, async (c) => {
  const currentUser = c.get('user')
  const body = c.req.valid('json')

  const isSystem = body.is_system === true
  if (isSystem && currentUser.role !== 'admin') {
    return c.json({ error: 'Only admins can create system workspaces' }, 403)
  }

  try {
    let agentType = body.agent_type || 'claude-code'
    let resolvedComputeResources = body.compute_resources
    let templateLatestVersion: number | undefined
    let templateVersion: Awaited<ReturnType<typeof getTemplateVersion>> = null

    if (body.template_id) {
      const template = await getTemplateForUser(body.template_id, currentUser.sub)
      if (!template) {
        return c.json({ error: 'Template not found' }, 404)
      }
      templateLatestVersion = template.latest_version
      templateVersion = await getTemplateVersion(body.template_id, template.latest_version)
      if (templateVersion) {
        agentType = templateVersion.agent_type || agentType
        if (
          templateVersion.compute_resources &&
          Object.keys(templateVersion.compute_resources).length > 0
        ) {
          resolvedComputeResources = templateVersion.compute_resources as Record<string, string>
        }
      }
    }

    const ownerId = isSystem ? 'system' : currentUser.sub
    const workspace = await createWorkspace(ownerId, body.name, agentType, isSystem)

    if (body.template_id && templateLatestVersion !== undefined) {
      await updateWorkspaceConfig(workspace.id, {
        template_id: body.template_id,
        template_version: templateLatestVersion,
      })
      if (templateVersion && templateVersion.skill_ids.length > 0) {
        // Skills baked into the template must be visible to the user creating
        // this workspace — link invariant guards templates created post-082,
        // but legacy templates may still reference private skills.
        const notVisible = await skillRepo.findSkillIdsNotVisibleToUser(
          templateVersion.skill_ids,
          currentUser.sub,
        )
        if (notVisible.length > 0) {
          return c.json(
            { error: `Template uses skills not visible to you: ${notVisible.join(', ')}` },
            403,
          )
        }
        await skillRepo.setWorkspaceSkills(workspace.id, templateVersion.skill_ids)
      }
      // Materialize the template's schedules as real rows + pg-boss timers.
      // `schedule_overrides` is the recipient's consent (name → enabled); absent
      // entries fall back to each schedule's enabled_default.
      await materializeTemplateSchedules({
        workspaceId: workspace.id,
        userId: currentUser.sub,
        templateId: body.template_id,
        version: templateLatestVersion,
        enabledOverrides: body.schedule_overrides,
      })
      // Copy the template's referenced layout into a recipient-owned row and
      // point the new workspace's profile at it (built-in default if none).
      await materializeTemplateLayout({
        workspaceId: workspace.id,
        userId: currentUser.sub,
        templateId: body.template_id,
        version: templateLatestVersion,
      })
    } else {
      const configPatch: Record<string, any> = {}
      if (body.provider_id) configPatch.provider_id = body.provider_id
      if (body.provider_type) configPatch.provider_type = body.provider_type
      if (body.base_url) configPatch.base_url = body.base_url
      if (body.api_key) configPatch.api_key = body.api_key
      if (body.model) configPatch.model = body.model
      if (body.small_model) configPatch.small_model = body.small_model
      if (body.prompt_id) configPatch.prompt_id = body.prompt_id
      if (body.system_prompt) configPatch.system_prompt = body.system_prompt
      if (body.mcp_config) configPatch.mcp_config = body.mcp_config
      if (body.agent_settings) configPatch.agent_settings = body.agent_settings
      if (resolvedComputeResources && Object.keys(resolvedComputeResources).length > 0) {
        configPatch.compute_resources = resolvedComputeResources
      }
      if (Object.keys(configPatch).length > 0) {
        await updateWorkspaceConfig(workspace.id, configPatch)
      }
      // p3: prefer skill_ids; the legacy skill_names path is dropped here because
      // names are no longer globally unique — clients must send ids. Old clients
      // that still send only skill_names will simply not attach any skills.
      if (body.skill_ids && body.skill_ids.length > 0) {
        const notVisible = await skillRepo.findSkillIdsNotVisibleToUser(
          body.skill_ids,
          currentUser.sub,
        )
        if (notVisible.length > 0) {
          return c.json({ error: `Skills not visible to you: ${notVisible.join(', ')}` }, 403)
        }
        await skillRepo.setWorkspaceSkills(workspace.id, body.skill_ids)
      }
    }

    // Auto-provision the workspace's default memory store + attach it. Skipped
    // for system workspaces (shared, no human owner to file the store under)
    // and when the cluster doesn't ship the memory-fuse image (sidecar
    // wouldn't be present — store would just be dead weight in the prompt).
    if (!isSystem && isMemoryFuseAvailable()) {
      try {
        // Reuse the workspace name verbatim so the store is identifiable from
        // the user's locale without cp needing an i18n layer. Description is
        // left empty — the user can edit either in the Memory app later.
        const store = await createStore({
          ownerUserId: currentUser.sub,
          name: body.name,
        })
        await attachStore({
          workspaceId: workspace.id,
          storeId: store.id,
          access: 'read_write',
        })
      } catch (e: any) {
        // Don't fail ws creation if the memory bootstrap trips — user can
        // still attach a store later via the global Memory app.
        console.error(`[workspace ${workspace.id}] auto-attach memory store failed:`, e.message)
      }
    }

    const config = await getWorkspaceConfig(workspace.id)
    await k8s.createInstance(workspace.id, agentType, config?.compute_resources)
    await updateWorkspace(workspace.id, { status: 'starting' })

    const updated = (await getWorkspace(workspace.id))!
    return c.json(toApiWorkspace(updated, currentUser.username), 201)
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ── PATCH /:id ─────────────────────────────────────────────────────────────
const patchRoute = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['workspaces'],
  summary: 'Rename a workspace or change its slug / visibility',
  security: [{ bearerAuth: [] }],
  request: {
    params: WorkspaceIdParam,
    body: { content: { 'application/json': { schema: WorkspacePatchBodySchema } } },
  },
  responses: {
    200: {
      description: 'Updated workspace',
      content: { 'application/json': { schema: ApiWorkspaceSchema } },
    },
    400: { description: 'Invalid input', content: { 'application/json': { schema: ErrorSchema } } },
    404: {
      description: 'Workspace not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    409: {
      description: 'Slug already in use',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

write.openapi(patchRoute, async (c) => {
  const currentUser = c.get('user')
  const { id } = c.req.valid('param')
  const body = c.req.valid('json')

  const workspace = await getWorkspace(id)
  if (!workspace || !canManage(workspace, currentUser)) {
    return c.json({ error: 'Workspace not found' }, 404)
  }

  const patch: Parameters<typeof updateWorkspace>[1] = {}
  if (body.name !== undefined) {
    if (!body.name.trim()) return c.json({ error: 'name cannot be empty' }, 400)
    patch.name = body.name.trim()
  }
  if (body.slug !== undefined) patch.slug = body.slug
  if (body.visibility !== undefined) patch.visibility = body.visibility

  if (Object.keys(patch).length === 0) {
    return c.json({ error: 'No fields to update' }, 400)
  }

  try {
    await updateWorkspace(id, patch)
  } catch (e: any) {
    if (e.code === '23505' && e.constraint?.includes('slug')) {
      return c.json({ error: 'slug already in use' }, 409)
    }
    throw e
  }
  const updated = (await getWorkspace(id))!
  return c.json(toApiWorkspace(updated, currentUser.username), 200)
})

// ── DELETE /:id ────────────────────────────────────────────────────────────
const deleteRouteDef = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['workspaces'],
  summary: 'Delete a workspace and its underlying instance',
  security: [{ bearerAuth: [] }],
  request: { params: WorkspaceIdParam },
  responses: {
    200: { description: 'Deleted', content: { 'application/json': { schema: SuccessSchema } } },
    404: {
      description: 'Workspace not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

write.openapi(deleteRouteDef, async (c) => {
  const currentUser = c.get('user')
  const { id } = c.req.valid('param')
  const workspace = await getWorkspace(id)
  if (!workspace || !canManage(workspace, currentUser)) {
    return c.json({ error: 'Workspace not found' }, 404)
  }

  if (workspace.status === 'running') {
    const address = getWorkspaceAddress(workspace.id)
    const sessionIds = await listActiveSessionIds(workspace.id)
    for (const sid of sessionIds) {
      try {
        await fetch(`${address}/sessions/${sid}/interrupt`, { method: 'POST' })
      } catch (e) {
        console.error('[Delete] Failed to interrupt session:', e)
      }
    }
  }

  // Unregister pg-boss timers before the schedule rows are CASCADE-deleted with
  // the workspace — otherwise cron registrations / one-time jobs leak in pg-boss.
  for (const s of await listSchedulesByWorkspace(id)) {
    await jobs.cancelScheduleTimer(s).catch(() => {})
  }

  await k8s.deleteInstance(workspace.id)
  await fireDeleteHooks(id)
  await deleteWorkspace(id)
  return c.json({ success: true }, 200)
})

// ── PUT /:id/config ────────────────────────────────────────────────────────
const PutConfigResponseSchema = z.object({
  success: z.boolean(),
  reloaded: z.boolean().optional(),
  rebuilt: z.boolean().optional(),
})

const putConfigRoute = createRoute({
  method: 'put',
  path: '/{id}/config',
  tags: ['workspaces'],
  summary: 'Update workspace agent configuration',
  description:
    'Empty `api_key` is treated as "do not change". Changing `agent_type` while running rebuilds the container.',
  security: [{ bearerAuth: [] }],
  request: {
    params: WorkspaceIdParam,
    body: {
      content: { 'application/json': { schema: ApiWorkspaceConfigSchema.partial() } },
    },
  },
  responses: {
    200: {
      description: 'Config applied',
      content: { 'application/json': { schema: PutConfigResponseSchema } },
    },
    404: {
      description: 'Workspace not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

write.openapi(putConfigRoute, async (c) => {
  const currentUser = c.get('user')
  const { id } = c.req.valid('param')
  const body = { ...c.req.valid('json') }

  const workspace = await getWorkspace(id)
  if (!workspace || !canManage(workspace, currentUser)) {
    return c.json({ error: 'Workspace not found' }, 404)
  }

  if (body.api_key !== undefined && !body.api_key) {
    // biome-ignore lint/performance/noDelete: must drop the key, undefined would still be persisted
    delete body.api_key
  }

  const { rebuilt, reloaded } = await applyWorkspaceConfigUpdate(id, body)
  if (rebuilt) {
    return c.json({ success: true, rebuilt: true }, 200)
  }

  if (body.compute_resources && workspace.status === 'running') {
    const cr = body.compute_resources
    try {
      if (cr.cpu_request || cr.cpu_limit || cr.memory_request || cr.memory_limit) {
        await k8s.updateInstanceResources(id, cr)
        await updateWorkspace(id, { status: 'starting' })
      }
      if (cr.storage) {
        await k8s.expandInstanceStorage(id, cr.storage)
      }
    } catch (e: any) {
      console.error(`[config] Failed to apply compute resources for workspace=${id}:`, e.message)
    }
  }

  return c.json({ success: true, reloaded }, 200)
})

export default write
