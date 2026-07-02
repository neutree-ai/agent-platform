import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  type ApiEnvironment,
  ApiEnvironmentGrantSchema,
  ApiEnvironmentSchema,
  ApiEnvironmentTokenSchema,
  CreatedEnvironmentTokenSchema,
  EnvironmentCreateBodySchema,
  EnvironmentGrantsBodySchema,
  EnvironmentTokenCreateBodySchema,
  EnvironmentUpdateBodySchema,
} from '../../../internal/types/api'
import type { AppEnv } from '../lib/types'
import {
  createEnvironmentToken,
  listEnvironmentTokens,
  revokeEnvironmentToken,
} from '../services/db/environment-tokens'
import {
  type EnvironmentWithAccess,
  countPlacementsInEnvironment,
  createEnvironment,
  deleteEnvironment,
  getEnvironmentForUser,
  listEnvironmentGrants,
  listVisibleToUser,
  setEnvironmentGrants,
  updateEnvironment,
} from '../services/db/environments'
import { getTeamMembership } from '../services/db/teams'

const environments = new OpenAPIHono<AppEnv>()

const ErrorSchema = z.object({ error: z.string() })
const SuccessSchema = z.object({ success: z.boolean() })

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

const IdParam = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' } }),
})

function toApi(e: EnvironmentWithAccess): ApiEnvironment {
  return {
    id: e.id,
    name: e.name,
    visibility: e.visibility,
    kind: e.kind,
    status: e.status,
    capabilities: e.capabilities,
    is_builtin: e.is_builtin,
    last_heartbeat_at: e.last_heartbeat_at,
    owner_name: e.owner_name,
    is_own: e.is_owner,
    my_permission: e.my_permission,
    shared_via_teams: e.shared_via_teams,
    created_at: e.created_at,
  }
}

// ── GET / — environments visible to the user (placement candidates) ──
const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['environments'],
  summary: 'List environments visible to the user (own + public + team-shared)',
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Environment list',
      content: { 'application/json': { schema: z.array(ApiEnvironmentSchema) } },
    },
  },
})

environments.openapi(listRoute, async (c) => {
  const user = c.get('user')
  const list = await listVisibleToUser(user.sub)
  return c.json(list.map(toApi), 200)
})

// ── GET /:id ──
const getRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['environments'],
  summary: 'Get an environment the user can access',
  security: [{ bearerAuth: [] }],
  request: { params: IdParam },
  responses: {
    200: {
      description: 'Environment',
      content: { 'application/json': { schema: ApiEnvironmentSchema } },
    },
    404: {
      description: 'Not found or no access',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

environments.openapi(getRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const env = await getEnvironmentForUser(id, user.sub)
  if (!env) return c.json({ error: 'Environment not found' }, 404)
  return c.json(toApi(env), 200)
})

// ── POST / — register a remote environment ──
const createRouteDef = createRoute({
  method: 'post',
  path: '/',
  tags: ['environments'],
  summary: 'Register a remote environment',
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { 'application/json': { schema: EnvironmentCreateBodySchema } } },
  },
  responses: {
    201: {
      description: 'Created',
      content: { 'application/json': { schema: ApiEnvironmentSchema } },
    },
    400: {
      description: 'Invalid grants for visibility',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    403: {
      description: 'Non-admin attempting to create a public environment',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    409: {
      description: 'Name already in use',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

environments.openapi(createRouteDef, async (c) => {
  const user = c.get('user')
  const body = c.req.valid('json')
  const visibility = body.visibility ?? 'private'
  const grants = body.grants ?? []
  // Unlike content resources (prompts/skills/templates/providers), a public
  // environment shares *infrastructure*: any user on the instance can schedule
  // workspace pods onto the owner's cluster (their cost, capacity, and security
  // blast radius). Offering an instance-wide shared environment is an operator
  // decision, so creating one is admin-only; regular users get private + team.
  if (visibility === 'public' && user.role !== 'admin') {
    return c.json({ error: 'Only admins can create public environments' }, 403)
  }
  if (visibility === 'team' && grants.length === 0) {
    return c.json({ error: 'visibility=team requires at least one grant' }, 400)
  }
  if (visibility !== 'team' && grants.length > 0) {
    return c.json({ error: 'grants only allowed when visibility=team' }, 400)
  }
  const teamCheck = await assertOwnTeams(user.sub, grants)
  if (!teamCheck.ok) return c.json({ error: teamCheck.error }, 400)

  try {
    const env = await createEnvironment(user.sub, body.name, body.kind, visibility, body.placement)
    if (grants.length > 0) await setEnvironmentGrants(env.id, grants, user.sub)
    const decorated = await getEnvironmentForUser(env.id, user.sub)
    return c.json(toApi(decorated!), 201)
  } catch (e) {
    if ((e as { code?: string })?.code === '23505') {
      return c.json({ error: 'An environment with this name already exists' }, 409)
    }
    throw e
  }
})

// ── PUT /:id — owner only, never built-in ──
const updateRouteDef = createRoute({
  method: 'put',
  path: '/{id}',
  tags: ['environments'],
  summary: 'Update a remote environment (owner only)',
  security: [{ bearerAuth: [] }],
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: EnvironmentUpdateBodySchema } } },
  },
  responses: {
    200: {
      description: 'Updated',
      content: { 'application/json': { schema: ApiEnvironmentSchema } },
    },
    400: {
      description: 'Invalid grants for visibility',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    403: {
      description: 'Non-admin attempting to make an environment public',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Not found or not owner',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

environments.openapi(updateRouteDef, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const existing = await getEnvironmentForUser(id, user.sub)
  if (!existing || !existing.is_owner || existing.is_builtin) {
    return c.json({ error: 'Environment not found' }, 404)
  }
  const body = c.req.valid('json')
  // Same guard as create, but only on *promotion*: a non-admin owner of an
  // already-public environment can still rename it without tripping this.
  if (body.visibility === 'public' && existing.visibility !== 'public' && user.role !== 'admin') {
    return c.json({ error: 'Only admins can make an environment public' }, 403)
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
    await setEnvironmentGrants(id, [], user.sub)
  }

  await updateEnvironment(id, {
    name: body.name,
    visibility: body.visibility,
    placement: body.placement,
  })
  if (nextGrants !== undefined) await setEnvironmentGrants(id, nextGrants, user.sub)
  const decorated = await getEnvironmentForUser(id, user.sub)
  return c.json(toApi(decorated!), 200)
})

// ── DELETE /:id — owner only, never built-in ──
const deleteRouteDef = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['environments'],
  summary: 'Delete a remote environment (owner only)',
  security: [{ bearerAuth: [] }],
  request: { params: IdParam },
  responses: {
    200: { description: 'Deleted', content: { 'application/json': { schema: SuccessSchema } } },
    404: {
      description: 'Not found or not owner',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    409: {
      description: 'Environment still has workspaces',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

environments.openapi(deleteRouteDef, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const existing = await getEnvironmentForUser(id, user.sub)
  if (!existing || !existing.is_owner || existing.is_builtin) {
    return c.json({ error: 'Environment not found' }, 404)
  }
  // Refuse to delete an environment that still hosts workspaces — their pods
  // live in the customer cluster and would be orphaned. (The workspace_placements
  // FK also blocks this at the DB, but as a raw 500; pre-check for a clean 409.)
  const inUse = await countPlacementsInEnvironment(id)
  if (inUse > 0) {
    return c.json(
      { error: `Environment still has ${inUse} workspace(s); delete or move them first` },
      409,
    )
  }
  try {
    await deleteEnvironment(id)
  } catch (e) {
    // Concurrency backstop: a workspace placed between the check and the delete
    // trips the FK (23503). Surface the same clean 409, not the raw pg error.
    if ((e as { code?: string })?.code === '23503') {
      return c.json({ error: 'Environment still has workspaces; delete or move them first' }, 409)
    }
    throw e
  }
  return c.json({ success: true }, 200)
})

// ── GET /:id/grants ──
const listGrantsRoute = createRoute({
  method: 'get',
  path: '/{id}/grants',
  tags: ['environments'],
  summary: 'List team grants (owner only)',
  security: [{ bearerAuth: [] }],
  request: { params: IdParam },
  responses: {
    200: {
      description: 'Grants',
      content: { 'application/json': { schema: z.array(ApiEnvironmentGrantSchema) } },
    },
    404: {
      description: 'Not found or not owner',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

environments.openapi(listGrantsRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const existing = await getEnvironmentForUser(id, user.sub)
  if (!existing || !existing.is_owner) return c.json({ error: 'Environment not found' }, 404)
  return c.json(await listEnvironmentGrants(id), 200)
})

// ── PUT /:id/grants ──
const setGrantsRoute = createRoute({
  method: 'put',
  path: '/{id}/grants',
  tags: ['environments'],
  summary: 'Replace team grants (owner only)',
  security: [{ bearerAuth: [] }],
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: EnvironmentGrantsBodySchema } } },
  },
  responses: {
    200: {
      description: 'Grants',
      content: { 'application/json': { schema: z.array(ApiEnvironmentGrantSchema) } },
    },
    400: {
      description: 'Invalid grants',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Not found or not owner',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

environments.openapi(setGrantsRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const existing = await getEnvironmentForUser(id, user.sub)
  if (!existing || !existing.is_owner) return c.json({ error: 'Environment not found' }, 404)
  const { grants } = c.req.valid('json')
  if (existing.visibility !== 'team' && grants.length > 0) {
    return c.json({ error: 'grants only allowed when visibility=team' }, 400)
  }
  const teamCheck = await assertOwnTeams(user.sub, grants)
  if (!teamCheck.ok) return c.json({ error: teamCheck.error }, 400)
  await setEnvironmentGrants(id, grants, user.sub)
  return c.json(await listEnvironmentGrants(id), 200)
})

// ── POST /:id/tokens — issue a runner token (owner only). Plaintext once. ──
const createTokenRoute = createRoute({
  method: 'post',
  path: '/{id}/tokens',
  tags: ['environments'],
  summary: 'Issue a runner token for an environment (owner only)',
  security: [{ bearerAuth: [] }],
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: EnvironmentTokenCreateBodySchema } } },
  },
  responses: {
    201: {
      description: 'Created token (plaintext shown once)',
      content: { 'application/json': { schema: CreatedEnvironmentTokenSchema } },
    },
    404: {
      description: 'Not found or not owner',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

environments.openapi(createTokenRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const existing = await getEnvironmentForUser(id, user.sub)
  // Built-in is served by the direct-DB runner and must never get a token.
  if (!existing || !existing.is_owner || existing.is_builtin) {
    return c.json({ error: 'Environment not found' }, 404)
  }
  const { name } = c.req.valid('json')
  const token = await createEnvironmentToken(id, name, user.sub)
  return c.json(token, 201)
})

// ── GET /:id/tokens — list active tokens (metadata only, owner only) ──
const listTokensRoute = createRoute({
  method: 'get',
  path: '/{id}/tokens',
  tags: ['environments'],
  summary: 'List active runner tokens (owner only)',
  security: [{ bearerAuth: [] }],
  request: { params: IdParam },
  responses: {
    200: {
      description: 'Tokens',
      content: { 'application/json': { schema: z.array(ApiEnvironmentTokenSchema) } },
    },
    404: {
      description: 'Not found or not owner',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

environments.openapi(listTokensRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const existing = await getEnvironmentForUser(id, user.sub)
  if (!existing || !existing.is_owner) return c.json({ error: 'Environment not found' }, 404)
  const tokens = await listEnvironmentTokens(id)
  return c.json(
    tokens.map((t) => ({
      id: t.id,
      name: t.name,
      created_by: t.created_by,
      created_at: t.created_at,
      revoked_at: t.revoked_at,
    })),
    200,
  )
})

// ── DELETE /:id/tokens/:tokenId — revoke (owner only) ──
const TokenIdParam = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' } }),
  tokenId: z.string().openapi({ param: { name: 'tokenId', in: 'path' } }),
})

const revokeTokenRoute = createRoute({
  method: 'delete',
  path: '/{id}/tokens/{tokenId}',
  tags: ['environments'],
  summary: 'Revoke a runner token (owner only)',
  security: [{ bearerAuth: [] }],
  request: { params: TokenIdParam },
  responses: {
    200: { description: 'Revoked', content: { 'application/json': { schema: SuccessSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

environments.openapi(revokeTokenRoute, async (c) => {
  const user = c.get('user')
  const { id, tokenId } = c.req.valid('param')
  const existing = await getEnvironmentForUser(id, user.sub)
  if (!existing || !existing.is_owner) return c.json({ error: 'Environment not found' }, 404)
  const ok = await revokeEnvironmentToken(tokenId, id)
  if (!ok) return c.json({ error: 'Token not found' }, 404)
  return c.json({ success: true }, 200)
})

export default environments
