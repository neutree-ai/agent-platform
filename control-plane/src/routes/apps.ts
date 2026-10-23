import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { AppClientEnv } from '../lib/types'
import { appAuth } from '../middleware/app-auth'
import {
  deleteAppPrompt,
  deleteAppSkill,
  listAppPrompts,
  listAppSkills,
  putAppPrompt,
  putAppSkill,
} from '../services/app-content'
import { getAppUser, upsertAppUser } from '../services/db/app-users'
import { ensurePlatformToken } from '../services/db/shares'
import type { User } from '../services/db/types'
import { deleteUser } from '../services/db/users'
import { issueAppUserToken } from '../services/oauth-provider'
import {
  ConflictError,
  InvalidInputError,
  MAX_SKILL_PACKAGE_BYTES,
} from '../services/skills-errors'

// Application protocol (/apps/v1/*). An application registered under
// /api/applications provisions its own users here and obtains short-lived
// tokens to call the rest of the API as each of them, and publishes the
// prompts and skills its users' agents use. Every route is scoped to the
// calling application: an external id or a name another application uses, or
// a NAP account, is simply not found.
const apps = new OpenAPIHono<AppClientEnv>()

apps.use('/v1/*', appAuth)

const ErrorSchema = z.object({ error: z.string() })
const SuccessSchema = z.object({ success: z.boolean() })

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
      content: { 'application/json': { schema: SuccessSchema } },
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

// ── Content ────────────────────────────────────────────────────────────────
// Prompts and skills the application publishes. They are shared with the
// application's team, so its users' agents can use them; publishing the same
// content again changes nothing.

const ContentNameParam = z.object({
  name: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/)
    .openapi({
      param: { name: 'name', in: 'path' },
      description: "The application's own name for it",
    }),
})

const AppPromptSchema = z
  .object({
    name: z.string(),
    version: z.number().int().openapi({ description: 'Goes up each time the text changes' }),
    updated_at: z.string(),
  })
  .openapi('AppPrompt')

const AppSkillSchema = z
  .object({
    name: z.string(),
    description: z.string(),
    version: z
      .number()
      .int()
      .openapi({ description: 'Goes up each time a package with new content is published' }),
    content_hash: z.string(),
    updated_at: z.string(),
  })
  .openapi('AppSkill')

// ── GET /v1/prompts ────────────────────────────────────────────────────────
const listPromptsRoute = createRoute({
  method: 'get',
  path: '/v1/prompts',
  tags: ['apps'],
  summary: "List the application's prompts",
  security: [{ appClientAuth: [] }],
  responses: {
    200: {
      description: 'Prompts',
      content: { 'application/json': { schema: z.array(AppPromptSchema) } },
    },
  },
})

apps.openapi(listPromptsRoute, async (c) => {
  const { clientId } = c.get('appPrincipal')
  return c.json(await listAppPrompts(clientId), 200)
})

// ── PUT /v1/prompts/{name} ─────────────────────────────────────────────────
const putPromptRoute = createRoute({
  method: 'put',
  path: '/v1/prompts/{name}',
  tags: ['apps'],
  summary: 'Publish a prompt',
  description: 'Creates the prompt, or adds a version when the text differs from the current one.',
  security: [{ appClientAuth: [] }],
  request: {
    params: ContentNameParam,
    body: {
      content: {
        'application/json': { schema: z.object({ content: z.string().min(1) }) },
      },
    },
  },
  responses: {
    200: {
      description: 'The prompt already existed',
      content: { 'application/json': { schema: AppPromptSchema } },
    },
    201: {
      description: 'The prompt was created',
      content: { 'application/json': { schema: AppPromptSchema } },
    },
  },
})

apps.openapi(putPromptRoute, async (c) => {
  const { clientId } = c.get('appPrincipal')
  const { name } = c.req.valid('param')
  const { content } = c.req.valid('json')
  const { prompt, created } = await putAppPrompt(clientId, name, content)
  return c.json(prompt, created ? 201 : 200)
})

// ── DELETE /v1/prompts/{name} ──────────────────────────────────────────────
const deletePromptRoute = createRoute({
  method: 'delete',
  path: '/v1/prompts/{name}',
  tags: ['apps'],
  summary: 'Delete a prompt',
  security: [{ appClientAuth: [] }],
  request: { params: ContentNameParam },
  responses: {
    200: { description: 'Deleted', content: { 'application/json': { schema: SuccessSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    409: { description: 'Still in use', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

apps.openapi(deletePromptRoute, async (c) => {
  const { clientId } = c.get('appPrincipal')
  const { name } = c.req.valid('param')
  try {
    if (!(await deleteAppPrompt(clientId, name))) {
      return c.json({ error: 'Prompt not found' }, 404)
    }
  } catch (err) {
    if ((err as { code?: string }).code === '23503') {
      return c.json({ error: 'Prompt is still in use' }, 409)
    }
    throw err
  }
  return c.json({ success: true }, 200)
})

// ── GET /v1/skills ─────────────────────────────────────────────────────────
const listSkillsRoute = createRoute({
  method: 'get',
  path: '/v1/skills',
  tags: ['apps'],
  summary: "List the application's skills",
  security: [{ appClientAuth: [] }],
  responses: {
    200: {
      description: 'Skills',
      content: { 'application/json': { schema: z.array(AppSkillSchema) } },
    },
  },
})

apps.openapi(listSkillsRoute, async (c) => {
  const { clientId } = c.get('appPrincipal')
  return c.json(await listAppSkills(clientId), 200)
})

// ── PUT /v1/skills/{name} ──────────────────────────────────────────────────
const putSkillRoute = createRoute({
  method: 'put',
  path: '/v1/skills/{name}',
  tags: ['apps'],
  summary: 'Publish a skill',
  description:
    'The body is the skill package, a .tar.gz or .zip with SKILL.md at its root; ' +
    'the description defaults to the one SKILL.md gives. Creates the skill, or ' +
    'makes the package its active version. Package bytes decide whether it is ' +
    'new: build the archive reproducibly so the same files publish as the same version.',
  security: [{ appClientAuth: [] }],
  request: {
    params: ContentNameParam,
    query: z.object({ description: z.string().max(1000).optional() }),
  },
  responses: {
    200: {
      description: 'The skill already existed',
      content: { 'application/json': { schema: AppSkillSchema } },
    },
    201: {
      description: 'The skill was created',
      content: { 'application/json': { schema: AppSkillSchema } },
    },
    400: {
      description: 'Not a skill package',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    413: {
      description: 'Package exceeds the size limit',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

apps.openapi(putSkillRoute, async (c) => {
  const { clientId } = c.get('appPrincipal')
  const { name } = c.req.valid('param')
  const { description } = c.req.valid('query')
  const tooLarge = { error: 'Skill package exceeds the size limit' }
  if (Number(c.req.header('content-length') || 0) > MAX_SKILL_PACKAGE_BYTES) {
    return c.json(tooLarge, 413)
  }
  // Read whole: the package is checked before it is stored.
  const pkg = new Uint8Array(await c.req.arrayBuffer())
  if (pkg.byteLength > MAX_SKILL_PACKAGE_BYTES) return c.json(tooLarge, 413)
  if (pkg.byteLength === 0) return c.json({ error: 'Empty body' }, 400)
  try {
    const { skill, created } = await putAppSkill(clientId, {
      name,
      description,
      package: pkg,
      signal: c.req.raw.signal,
    })
    return c.json(skill, created ? 201 : 200)
  } catch (err) {
    if (err instanceof InvalidInputError) return c.json({ error: err.message }, 400)
    throw err
  }
})

// ── DELETE /v1/skills/{name} ───────────────────────────────────────────────
const deleteSkillRoute = createRoute({
  method: 'delete',
  path: '/v1/skills/{name}',
  tags: ['apps'],
  summary: 'Delete a skill',
  security: [{ appClientAuth: [] }],
  request: { params: ContentNameParam },
  responses: {
    200: { description: 'Deleted', content: { 'application/json': { schema: SuccessSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    409: { description: 'Still in use', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

apps.openapi(deleteSkillRoute, async (c) => {
  const { clientId } = c.get('appPrincipal')
  const { name } = c.req.valid('param')
  try {
    if (!(await deleteAppSkill(clientId, name))) {
      return c.json({ error: 'Skill not found' }, 404)
    }
  } catch (err) {
    if (err instanceof ConflictError) return c.json({ error: err.message }, 409)
    throw err
  }
  return c.json({ success: true }, 200)
})

export default apps
