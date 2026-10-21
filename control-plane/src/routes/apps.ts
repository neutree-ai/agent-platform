import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { AppClientEnv } from '../lib/types'
import { appAuth } from '../middleware/app-auth'
import { getAppUser, upsertAppUser } from '../services/db/app-users'
import { ensurePlatformToken } from '../services/db/shares'
import type { User } from '../services/db/types'
import { deleteUser } from '../services/db/users'
import { issueAppUserToken } from '../services/oauth-provider'

// Application protocol (/apps/v1/*). An application registered under
// /api/applications provisions its own users here and obtains short-lived
// tokens to call the rest of the API as each of them. Every route is scoped to
// the calling application's users: an external id another application uses,
// or a NAP account, is simply not found.
const apps = new OpenAPIHono<AppClientEnv>()

apps.use('/v1/*', appAuth)

const ErrorSchema = z.object({ error: z.string() })

const ExternalIdParam = z.object({
  external_id: z
    .string()
    .regex(/^[A-Za-z0-9._@+-]{1,128}$/)
    .openapi({
      param: { name: 'external_id', in: 'path' },
      description: "The application's own id for the user",
    }),
})

const AppUserSchema = z
  .object({
    id: z.string().openapi({ description: 'NAP user id' }),
    external_id: z.string(),
    username: z.string(),
    display_name: z.string(),
    email: z.string().nullable(),
    created_at: z.string(),
  })
  .openapi('AppUser')

function toAppUser(user: User, externalId: string): z.infer<typeof AppUserSchema> {
  return {
    id: user.id,
    external_id: externalId,
    username: user.username,
    display_name: user.display_name,
    email: user.email,
    created_at: new Date(user.created_at).toISOString(),
  }
}

// ── PUT /v1/users/{external_id} ────────────────────────────────────────────
const upsertRoute = createRoute({
  method: 'put',
  path: '/v1/users/{external_id}',
  tags: ['apps'],
  summary: 'Provision a user of the application, or update its name and email',
  description:
    'Idempotent. The user belongs to the calling application, has no password and ' +
    'cannot sign in to NAP; it joins the teams the application declares. Call it ' +
    'whenever the user signs in to the application.',
  security: [{ appClientAuth: [] }],
  request: {
    params: ExternalIdParam,
    body: {
      content: {
        'application/json': {
          schema: z.object({
            display_name: z.string().trim().min(1).max(200),
            email: z.string().email().nullable().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'The user already existed and was updated',
      content: { 'application/json': { schema: AppUserSchema } },
    },
    201: {
      description: 'The user was created',
      content: { 'application/json': { schema: AppUserSchema } },
    },
  },
})

apps.openapi(upsertRoute, async (c) => {
  const { clientId } = c.get('appPrincipal')
  const { external_id } = c.req.valid('param')
  const body = c.req.valid('json')
  const { user, created } = await upsertAppUser(
    clientId,
    external_id,
    body.display_name,
    body.email ?? null,
  )
  // Sandbox and browser sessions run on the workspace owner's platform token,
  // which interactive users get at sign-in. These users never sign in.
  await ensurePlatformToken(user.id)
  return c.json(toAppUser(user, external_id), created ? 201 : 200)
})

// ── DELETE /v1/users/{external_id} ─────────────────────────────────────────
const deleteRoute = createRoute({
  method: 'delete',
  path: '/v1/users/{external_id}',
  tags: ['apps'],
  summary: 'Delete a user of the application',
  description: "Delete the user's workspaces first; a user that still owns any is refused.",
  security: [{ appClientAuth: [] }],
  request: { params: ExternalIdParam },
  responses: {
    200: {
      description: 'Deleted',
      content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
    },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    409: {
      description: 'The user still owns resources',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

apps.openapi(deleteRoute, async (c) => {
  const { clientId } = c.get('appPrincipal')
  const { external_id } = c.req.valid('param')
  const user = await getAppUser(clientId, external_id)
  if (!user) return c.json({ error: 'User not found' }, 404)
  try {
    await deleteUser(user.id)
  } catch (err) {
    if ((err as { code?: string }).code === '23503') {
      return c.json({ error: 'User still owns workspaces or other resources' }, 409)
    }
    throw err
  }
  return c.json({ success: true }, 200)
})

// ── POST /v1/users/{external_id}/token ─────────────────────────────────────
const tokenRoute = createRoute({
  method: 'post',
  path: '/v1/users/{external_id}/token',
  tags: ['apps'],
  summary: 'Obtain a short-lived access token for a user of the application',
  description:
    'Pass it as `Authorization: Bearer <token>` to call the API as that user. ' +
    'Request a new one when it expires; there is no refresh token.',
  security: [{ appClientAuth: [] }],
  request: { params: ExternalIdParam },
  responses: {
    200: {
      description: 'Access token',
      content: {
        'application/json': {
          schema: z.object({
            access_token: z.string(),
            token_type: z.literal('Bearer'),
            expires_in: z.number().openapi({ description: 'Lifetime in seconds' }),
          }),
        },
      },
    },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

apps.openapi(tokenRoute, async (c) => {
  const { clientId } = c.get('appPrincipal')
  const { external_id } = c.req.valid('param')
  const user = await getAppUser(clientId, external_id)
  if (!user) return c.json({ error: 'User not found' }, 404)
  const { access_token, expires_in } = await issueAppUserToken(user, clientId)
  return c.json({ access_token, token_type: 'Bearer' as const, expires_in }, 200)
})

export default apps
