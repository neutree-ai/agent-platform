import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  ApiPromptGrantSchema,
  ApiPromptSchema,
  PromptCreateBodySchema,
  PromptGrantsBodySchema,
  PromptRollbackBodySchema,
  PromptUpdateBodySchema,
} from '../../../../internal/types/api'
import type { AppEnv } from '../../lib/types'
import {
  createPrompt,
  deletePrompt,
  getPromptForUser,
  listPromptGrants,
  rollbackPromptToVersion,
  setPromptGrants,
  updatePrompt,
} from '../../services/db/prompts'
import { getTeamMembership } from '../../services/db/teams'
import { reloadWorkspacesUsingPrompt, toApi } from './_shared'

const write = new OpenAPIHono<AppEnv>()

const ErrorSchema = z.object({ error: z.string() })
const SuccessSchema = z.object({ success: z.boolean() })

const IdParam = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' } }),
})

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

// ── POST / ─────────────────────────────────────────────────────────────────
const createRouteDef = createRoute({
  method: 'post',
  path: '/',
  tags: ['prompts'],
  summary: 'Create a prompt',
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { 'application/json': { schema: PromptCreateBodySchema } } },
  },
  responses: {
    201: {
      description: 'Created prompt',
      content: { 'application/json': { schema: ApiPromptSchema } },
    },
    400: {
      description: 'Invalid grants for visibility',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    409: {
      description: 'Name already in use',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

write.openapi(createRouteDef, async (c) => {
  const user = c.get('user')
  const body = c.req.valid('json')
  const visibility = body.visibility ?? 'private'
  const grants = body.grants ?? []
  if (visibility === 'team' && grants.length === 0) {
    return c.json({ error: 'visibility=team requires at least one grant' }, 400)
  }
  if (visibility !== 'team' && grants.length > 0) {
    return c.json({ error: 'grants only allowed when visibility=team' }, 400)
  }
  const teamCheck = await assertOwnTeams(user.sub, grants)
  if (!teamCheck.ok) return c.json({ error: teamCheck.error }, 400)

  try {
    const prompt = await createPrompt(user.sub, body.name, body.content ?? '', visibility)
    if (grants.length > 0) await setPromptGrants(prompt.id, grants, user.sub)
    const decorated = await getPromptForUser(prompt.id, user.sub)
    return c.json(toApi(decorated!), 201)
  } catch (e) {
    if ((e as { code?: string })?.code === '23505') {
      return c.json({ error: 'A prompt with this name already exists' }, 409)
    }
    throw e
  }
})

// ── PUT /:id ───────────────────────────────────────────────────────────────
const updateRoute = createRoute({
  method: 'put',
  path: '/{id}',
  tags: ['prompts'],
  summary:
    'Update a prompt. Owner can change anything; editors can change name/content. Reloads running workspaces.',
  security: [{ bearerAuth: [] }],
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: PromptUpdateBodySchema } } },
  },
  responses: {
    200: {
      description: 'Updated prompt',
      content: { 'application/json': { schema: ApiPromptSchema } },
    },
    400: {
      description: 'Invalid grants for visibility',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    403: {
      description: 'Not allowed to update this prompt',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Prompt not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

write.openapi(updateRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const existing = await getPromptForUser(id, user.sub)
  if (!existing) return c.json({ error: 'Prompt not found' }, 404)

  const body = c.req.valid('json')
  const isOwner = existing.is_owner
  const isEditor = existing.my_permission === 'editor'

  if (!isOwner && !isEditor) {
    return c.json({ error: 'Not allowed to update this prompt' }, 403)
  }
  if (!isOwner && (body.visibility !== undefined || body.grants !== undefined)) {
    return c.json({ error: 'Only the owner can change visibility or grants' }, 403)
  }

  const nextVisibility = body.visibility ?? existing.visibility
  const nextGrants = body.grants
  if (nextGrants !== undefined) {
    if (nextVisibility === 'team' && nextGrants.length === 0) {
      return c.json({ error: 'visibility=team requires at least one grant' }, 400)
    }
    if (nextVisibility !== 'team' && nextGrants.length > 0) {
      return c.json({ error: 'grants only allowed when visibility=team' }, 400)
    }
    const teamCheck = await assertOwnTeams(user.sub, nextGrants)
    if (!teamCheck.ok) return c.json({ error: teamCheck.error }, 400)
  } else if (body.visibility !== undefined && body.visibility !== 'team') {
    // Visibility moving away from team — clear grants
    await setPromptGrants(id, [], user.sub)
  }

  const updated = await updatePrompt(id, {
    name: body.name,
    content: body.content,
    visibility: body.visibility,
  })
  if (!updated) return c.json({ error: 'Prompt not found' }, 404)

  if (nextGrants !== undefined && isOwner) {
    await setPromptGrants(id, nextGrants, user.sub)
  }

  await reloadWorkspacesUsingPrompt(id)
  const decorated = await getPromptForUser(id, user.sub)
  return c.json(toApi(decorated!), 200)
})

// ── DELETE /:id ────────────────────────────────────────────────────────────
const deleteRouteDef = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['prompts'],
  summary: 'Delete a prompt (owner only)',
  security: [{ bearerAuth: [] }],
  request: { params: IdParam },
  responses: {
    200: { description: 'Deleted', content: { 'application/json': { schema: SuccessSchema } } },
    404: {
      description: 'Prompt not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

write.openapi(deleteRouteDef, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const existing = await getPromptForUser(id, user.sub)
  if (!existing || !existing.is_owner) {
    return c.json({ error: 'Prompt not found' }, 404)
  }
  await deletePrompt(id)
  return c.json({ success: true }, 200)
})

// ── POST /:id/rollback ─────────────────────────────────────────────────────
const rollbackRoute = createRoute({
  method: 'post',
  path: '/{id}/rollback',
  tags: ['prompts'],
  summary: 'Roll back to an earlier version (owner or editor)',
  security: [{ bearerAuth: [] }],
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: PromptRollbackBodySchema } } },
  },
  responses: {
    200: {
      description: 'Updated prompt',
      content: { 'application/json': { schema: ApiPromptSchema } },
    },
    403: {
      description: 'Not allowed',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Prompt or version not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

write.openapi(rollbackRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const existing = await getPromptForUser(id, user.sub)
  if (!existing) return c.json({ error: 'Prompt not found' }, 404)
  if (!existing.is_owner && existing.my_permission !== 'editor') {
    return c.json({ error: 'Not allowed' }, 403)
  }
  const { version } = c.req.valid('json')
  const updated = await rollbackPromptToVersion(id, version)
  if (!updated) return c.json({ error: 'Version not found' }, 404)

  await reloadWorkspacesUsingPrompt(id)
  const decorated = await getPromptForUser(id, user.sub)
  return c.json(toApi(decorated!), 200)
})

// ── GET /:id/grants ────────────────────────────────────────────────────────
const listGrantsRoute = createRoute({
  method: 'get',
  path: '/{id}/grants',
  tags: ['prompts'],
  summary: 'List team grants for a prompt (owner only)',
  security: [{ bearerAuth: [] }],
  request: { params: IdParam },
  responses: {
    200: {
      description: 'Grant list',
      content: { 'application/json': { schema: z.array(ApiPromptGrantSchema) } },
    },
    404: {
      description: 'Prompt not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

write.openapi(listGrantsRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const existing = await getPromptForUser(id, user.sub)
  if (!existing || !existing.is_owner) {
    return c.json({ error: 'Prompt not found' }, 404)
  }
  const rows = await listPromptGrants(id)
  return c.json(rows, 200)
})

// ── PUT /:id/grants ────────────────────────────────────────────────────────
const setGrantsRoute = createRoute({
  method: 'put',
  path: '/{id}/grants',
  tags: ['prompts'],
  summary: 'Replace team grants for a prompt (owner only)',
  security: [{ bearerAuth: [] }],
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: PromptGrantsBodySchema } } },
  },
  responses: {
    200: {
      description: 'Grant list',
      content: { 'application/json': { schema: z.array(ApiPromptGrantSchema) } },
    },
    400: {
      description: 'Invalid grants',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Prompt not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

write.openapi(setGrantsRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const existing = await getPromptForUser(id, user.sub)
  if (!existing || !existing.is_owner) {
    return c.json({ error: 'Prompt not found' }, 404)
  }
  const { grants } = c.req.valid('json')
  if (existing.visibility !== 'team' && grants.length > 0) {
    return c.json({ error: 'grants only allowed when visibility=team' }, 400)
  }
  const teamCheck = await assertOwnTeams(user.sub, grants)
  if (!teamCheck.ok) return c.json({ error: teamCheck.error }, 400)

  await setPromptGrants(id, grants, user.sub)
  await reloadWorkspacesUsingPrompt(id)
  const rows = await listPromptGrants(id)
  return c.json(rows, 200)
})

export default write
