import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { type ApiEnvironment, ApiEnvironmentSchema } from '../../../internal/types/api'
import type { AppEnv } from '../lib/types'
import {
  type EnvironmentWithAccess,
  getEnvironmentForUser,
  listVisibleToUser,
} from '../services/db/environments'

const environments = new OpenAPIHono<AppEnv>()

const ErrorSchema = z.object({ error: z.string() })

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

export default environments
