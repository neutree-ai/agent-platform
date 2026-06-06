import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  type ApiTemplate,
  ApiTemplateGrantSchema,
  ApiTemplateSchema,
  type ApiTemplateVersion,
  ApiTemplateVersionSchema,
  TemplateCreateBodySchema,
  TemplateGrantsBodySchema,
  TemplateLinkErrorSchema,
  TemplateUpdateBodySchema,
  TemplateUsageItemSchema,
  TemplateVersionCreateBodySchema,
} from '../../../internal/types/api'
import type { AppEnv } from '../lib/types'
import { getTeamMembership } from '../services/db/teams'
import { assertTemplateLinkVisible } from '../services/db/template-acl'
import {
  type TemplateVersionWithSkills,
  type TemplateWithAccess,
  createTemplate,
  createTemplateVersion,
  deleteTemplate,
  getLatestTemplateVersion,
  getTemplateForUser,
  getTemplateVersion,
  listTemplateGrants,
  listTemplateVersions,
  listVisibleToUser,
  setTemplateGrants,
  updateTemplate,
} from '../services/db/templates'
import { listWorkspacesUsingTemplate } from '../services/db/workspaces'

const templates = new OpenAPIHono<AppEnv>()

const ErrorSchema = z.object({ error: z.string() })
const SuccessSchema = z.object({ success: z.boolean() })

const IdParam = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' } }),
})

const IdVersionParam = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' } }),
  version: z.coerce
    .number()
    .int()
    .openapi({ param: { name: 'version', in: 'path' } }),
})

function toApi(t: TemplateWithAccess): ApiTemplate {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    owner_id: t.owner_id,
    owner_name: t.owner_name,
    is_owner: t.is_owner,
    visibility: t.visibility,
    my_permission: t.my_permission,
    shared_via_teams: t.shared_via_teams,
    latest_version: t.latest_version,
    created_at: t.created_at,
    updated_at: t.updated_at,
  }
}

function toVersionApi(v: TemplateVersionWithSkills): ApiTemplateVersion {
  return {
    id: v.id,
    template_id: v.template_id,
    version: v.version,
    agent_type: v.agent_type,
    system_prompt: v.system_prompt,
    prompt_id: v.prompt_id,
    prompt_version: v.prompt_version,
    mcp_config: v.mcp_config,
    agent_settings: v.agent_settings,
    compute_resources: v.compute_resources,
    provider_id: v.provider_id,
    provider_name: v.provider_name,
    model: v.model,
    small_model: v.small_model,
    skill_ids: v.skill_ids,
    skill_names: v.skill_names,
    commands: v.commands,
    schedules: v.schedules,
    layout_id: v.layout_id,
    created_at: v.created_at,
  }
}

async function assertOwnTeams(
  userId: string,
  grants: { team_id: string; permission: 'viewer' | 'editor' }[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  for (const g of grants) {
    const m = await getTeamMembership(g.team_id, userId)
    if (!m) return { ok: false, error: `Team ${g.team_id} not accessible` }
  }
  return { ok: true }
}

// ── GET / ──────────────────────────────────────────────────────────────────
const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['templates'],
  summary: 'List templates visible to the user (own + public + team-shared)',
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Template list',
      content: { 'application/json': { schema: z.array(ApiTemplateSchema) } },
    },
  },
})

templates.openapi(listRoute, async (c) => {
  const user = c.get('user')
  const list = await listVisibleToUser(user.sub)
  return c.json(list.map(toApi), 200)
})

// ── GET /:id ───────────────────────────────────────────────────────────────
const getRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['templates'],
  summary: 'Get a template by id (visibility-aware)',
  security: [{ bearerAuth: [] }],
  request: { params: IdParam },
  responses: {
    200: {
      description: 'Template',
      content: { 'application/json': { schema: ApiTemplateSchema } },
    },
    404: {
      description: 'Template not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

templates.openapi(getRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const template = await getTemplateForUser(id, user.sub)
  if (!template) return c.json({ error: 'Template not found' }, 404)
  return c.json(toApi(template), 200)
})

// ── POST / ─────────────────────────────────────────────────────────────────
const createRouteDef = createRoute({
  method: 'post',
  path: '/',
  tags: ['templates'],
  summary: 'Create a template',
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { 'application/json': { schema: TemplateCreateBodySchema } } },
  },
  responses: {
    201: { description: 'Created', content: { 'application/json': { schema: ApiTemplateSchema } } },
  },
})

templates.openapi(createRouteDef, async (c) => {
  const user = c.get('user')
  const body = c.req.valid('json')
  // No version yet at create time, so link check is moot. Default visibility
  // private; owner can switch later via PUT once a version exists.
  const visibility = body.visibility ?? 'private'
  const template = await createTemplate(user.sub, body.name, body.description ?? '', visibility)
  const decorated = await getTemplateForUser(template.id, user.sub)
  return c.json(toApi(decorated!), 201)
})

// ── PUT /:id ───────────────────────────────────────────────────────────────
const updateRoute = createRoute({
  method: 'put',
  path: '/{id}',
  tags: ['templates'],
  summary: 'Update template metadata. Owner: anything. Editor: name/description only.',
  security: [{ bearerAuth: [] }],
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: TemplateUpdateBodySchema } } },
  },
  responses: {
    200: { description: 'Updated', content: { 'application/json': { schema: ApiTemplateSchema } } },
    400: {
      description: 'Invalid grants or link visibility violation',
      content: { 'application/json': { schema: TemplateLinkErrorSchema } },
    },
    403: {
      description: 'Not allowed to update this template',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Template not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

templates.openapi(updateRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const existing = await getTemplateForUser(id, user.sub)
  if (!existing) return c.json({ error: 'Template not found' }, 404)
  const body = c.req.valid('json')
  const isOwner = existing.is_owner
  const isEditor = existing.my_permission === 'editor'
  if (!isOwner && !isEditor) {
    return c.json({ error: 'Not allowed to update this template' }, 403)
  }
  if (!isOwner && (body.visibility !== undefined || body.grants !== undefined)) {
    return c.json({ error: 'Only the owner can change visibility or grants' }, 403)
  }

  const nextVisibility = body.visibility ?? existing.visibility
  const nextGrants = body.grants
  if (nextGrants !== undefined) {
    if (nextVisibility === 'team' && nextGrants.length === 0) {
      return c.json({ error: 'visibility=team requires at least one grant', missing: [] }, 400)
    }
    if (nextVisibility !== 'team' && nextGrants.length > 0) {
      return c.json({ error: 'grants only allowed when visibility=team', missing: [] }, 400)
    }
    const teamCheck = await assertOwnTeams(user.sub, nextGrants)
    if (!teamCheck.ok) return c.json({ error: teamCheck.error, missing: [] }, 400)
  }

  // Link visibility check: if the template is/becomes shared, ensure the
  // referenced prompt/provider are visible to the same audience.
  if (isOwner && (body.visibility !== undefined || body.grants !== undefined)) {
    const latest = await getLatestTemplateVersion(id)
    const grantTeamIds =
      nextGrants !== undefined
        ? nextGrants.map((g) => g.team_id)
        : (await listTemplateGrants(id)).map((g) => g.team_id)
    const missing = await assertTemplateLinkVisible({
      templateOwnerId: existing.owner_id,
      visibility: nextVisibility,
      grantTeamIds,
      promptId: latest?.prompt_id ?? null,
      providerId: latest?.provider_id ?? null,
      skillIds: latest?.skill_ids ?? [],
    })
    if (missing.length > 0) {
      return c.json(
        { error: 'Linked prompt/provider/skill must be visible to the same audience', missing },
        400,
      )
    }
  }

  const updated = await updateTemplate(
    id,
    isOwner
      ? { name: body.name, description: body.description, visibility: body.visibility }
      : { name: body.name, description: body.description },
  )
  if (!updated) return c.json({ error: 'Template not found' }, 404)

  if (isOwner && nextGrants !== undefined) {
    await setTemplateGrants(id, nextGrants, user.sub)
  } else if (isOwner && body.visibility !== undefined && body.visibility !== 'team') {
    // Visibility moving away from team — clear any existing grants.
    await setTemplateGrants(id, [], user.sub)
  }

  const decorated = await getTemplateForUser(id, user.sub)
  return c.json(toApi(decorated!), 200)
})

// ── DELETE /:id ────────────────────────────────────────────────────────────
const deleteRouteDef = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['templates'],
  summary: 'Delete a template (owner only)',
  security: [{ bearerAuth: [] }],
  request: { params: IdParam },
  responses: {
    200: { description: 'Deleted', content: { 'application/json': { schema: SuccessSchema } } },
    404: {
      description: 'Template not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

templates.openapi(deleteRouteDef, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const existing = await getTemplateForUser(id, user.sub)
  if (!existing || !existing.is_owner) {
    return c.json({ error: 'Template not found' }, 404)
  }
  await deleteTemplate(id)
  return c.json({ success: true }, 200)
})

// ── GET /:id/versions ──────────────────────────────────────────────────────
const listVersionsRoute = createRoute({
  method: 'get',
  path: '/{id}/versions',
  tags: ['templates'],
  summary: 'List versions of a template',
  security: [{ bearerAuth: [] }],
  request: { params: IdParam },
  responses: {
    200: {
      description: 'Version list',
      content: { 'application/json': { schema: z.array(ApiTemplateVersionSchema) } },
    },
    404: {
      description: 'Template not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

templates.openapi(listVersionsRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const template = await getTemplateForUser(id, user.sub)
  if (!template) return c.json({ error: 'Template not found' }, 404)
  const versions = await listTemplateVersions(id)
  return c.json(versions.map(toVersionApi), 200)
})

// ── GET /:id/versions/:version ─────────────────────────────────────────────
const getVersionRoute = createRoute({
  method: 'get',
  path: '/{id}/versions/{version}',
  tags: ['templates'],
  summary: 'Get a specific version of a template',
  security: [{ bearerAuth: [] }],
  request: { params: IdVersionParam },
  responses: {
    200: {
      description: 'Version',
      content: { 'application/json': { schema: ApiTemplateVersionSchema } },
    },
    404: {
      description: 'Template or version not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

templates.openapi(getVersionRoute, async (c) => {
  const user = c.get('user')
  const { id, version } = c.req.valid('param')
  const template = await getTemplateForUser(id, user.sub)
  if (!template) return c.json({ error: 'Template not found' }, 404)
  const v = await getTemplateVersion(id, version)
  if (!v) return c.json({ error: 'Version not found' }, 404)
  return c.json(toVersionApi(v), 200)
})

// ── GET /:id/usage ─────────────────────────────────────────────────────────
const usageRoute = createRoute({
  method: 'get',
  path: '/{id}/usage',
  tags: ['templates'],
  summary: 'List workspaces (owned by the current user) that reference this template',
  security: [{ bearerAuth: [] }],
  request: { params: IdParam },
  responses: {
    200: {
      description: 'Usage list',
      content: { 'application/json': { schema: z.array(TemplateUsageItemSchema) } },
    },
    404: {
      description: 'Template not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

templates.openapi(usageRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const template = await getTemplateForUser(id, user.sub)
  if (!template) return c.json({ error: 'Template not found' }, 404)
  const workspaces = await listWorkspacesUsingTemplate(id)
  const visible = workspaces
    .filter((w) => w.user_id === user.sub)
    .map((w) => ({ id: w.id, name: w.name, status: w.status }))
  return c.json(visible, 200)
})

// ── POST /:id/versions ─────────────────────────────────────────────────────
const createVersionRoute = createRoute({
  method: 'post',
  path: '/{id}/versions',
  tags: ['templates'],
  summary: 'Create a new version of a template (owner or editor)',
  security: [{ bearerAuth: [] }],
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: TemplateVersionCreateBodySchema } } },
  },
  responses: {
    201: {
      description: 'Created version',
      content: { 'application/json': { schema: ApiTemplateVersionSchema } },
    },
    400: {
      description: 'New version would break link visibility for shared template',
      content: { 'application/json': { schema: TemplateLinkErrorSchema } },
    },
    403: {
      description: 'Not allowed to add versions to this template',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Template not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

templates.openapi(createVersionRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const existing = await getTemplateForUser(id, user.sub)
  if (!existing) return c.json({ error: 'Template not found' }, 404)
  if (!existing.is_owner && existing.my_permission !== 'editor') {
    return c.json({ error: 'Not allowed to add versions to this template' }, 403)
  }
  const body = c.req.valid('json')

  // p3: skill_ids is authoritative. Refuse legacy clients that send only
  // skill_names — silently coercing to [] would (a) bypass the per-skill
  // audience check below for any private/team skill the client implied, and
  // (b) create a version row with zero skill pins while returning 201. Both
  // are silent ACL/data losses.
  const legacyNames = (body as { skill_names?: string[] }).skill_names
  if (legacyNames && legacyNames.length > 0 && !body.skill_ids) {
    return c.json(
      {
        error:
          'skill_names is no longer accepted on template versions; send skill_ids (UUIDs) instead',
        missing: [],
      },
      400,
    )
  }

  // Link check on the version being added — applies whenever the template is
  // currently shared (visibility != private). Editor-shared versions still
  // ride the owner's audience commitment.
  if (existing.visibility !== 'private') {
    const grantTeamIds = (await listTemplateGrants(id)).map((g) => g.team_id)
    const missing = await assertTemplateLinkVisible({
      templateOwnerId: existing.owner_id,
      visibility: existing.visibility,
      grantTeamIds,
      promptId: body.prompt_id ?? null,
      providerId: body.provider_id ?? null,
      skillIds: body.skill_ids ?? [],
    })
    if (missing.length > 0) {
      return c.json(
        { error: 'Linked prompt/provider/skill must be visible to the same audience', missing },
        400,
      )
    }
  }

  const version = await createTemplateVersion(id, body)
  return c.json(toVersionApi(version), 201)
})

// ── GET /:id/grants ────────────────────────────────────────────────────────
const listGrantsRoute = createRoute({
  method: 'get',
  path: '/{id}/grants',
  tags: ['templates'],
  summary: 'List team grants for a template (owner only)',
  security: [{ bearerAuth: [] }],
  request: { params: IdParam },
  responses: {
    200: {
      description: 'Grant list',
      content: { 'application/json': { schema: z.array(ApiTemplateGrantSchema) } },
    },
    404: {
      description: 'Template not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

templates.openapi(listGrantsRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const existing = await getTemplateForUser(id, user.sub)
  if (!existing || !existing.is_owner) {
    return c.json({ error: 'Template not found' }, 404)
  }
  const rows = await listTemplateGrants(id)
  return c.json(rows, 200)
})

// ── PUT /:id/grants ────────────────────────────────────────────────────────
const setGrantsRoute = createRoute({
  method: 'put',
  path: '/{id}/grants',
  tags: ['templates'],
  summary: 'Replace team grants for a template (owner only)',
  security: [{ bearerAuth: [] }],
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: TemplateGrantsBodySchema } } },
  },
  responses: {
    200: {
      description: 'Grant list',
      content: { 'application/json': { schema: z.array(ApiTemplateGrantSchema) } },
    },
    400: {
      description: 'Invalid grants or link visibility violation',
      content: { 'application/json': { schema: TemplateLinkErrorSchema } },
    },
    404: {
      description: 'Template not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

templates.openapi(setGrantsRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const existing = await getTemplateForUser(id, user.sub)
  if (!existing || !existing.is_owner) {
    return c.json({ error: 'Template not found' }, 404)
  }
  const { grants } = c.req.valid('json')
  if (existing.visibility !== 'team' && grants.length > 0) {
    return c.json({ error: 'grants only allowed when visibility=team', missing: [] }, 400)
  }
  const teamCheck = await assertOwnTeams(user.sub, grants)
  if (!teamCheck.ok) return c.json({ error: teamCheck.error, missing: [] }, 400)

  const latest = await getLatestTemplateVersion(id)
  const missing = await assertTemplateLinkVisible({
    templateOwnerId: existing.owner_id,
    visibility: existing.visibility,
    grantTeamIds: grants.map((g) => g.team_id),
    promptId: latest?.prompt_id ?? null,
    providerId: latest?.provider_id ?? null,
    skillIds: latest?.skill_ids ?? [],
  })
  if (missing.length > 0) {
    return c.json(
      { error: 'Linked prompt/provider/skill must be visible to the same audience', missing },
      400,
    )
  }

  await setTemplateGrants(id, grants, user.sub)
  const rows = await listTemplateGrants(id)
  return c.json(rows, 200)
})

export default templates
