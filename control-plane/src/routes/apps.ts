import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { stringify as toYaml } from 'yaml'
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
import { SpecConflictError, applyAppSpec, getCurrentSpec } from '../services/app-spec/apply'
import { SpecError, parseAppSpec } from '../services/app-spec/schema'
import {
  AgentNotFoundError,
  AgentPlacementError,
  agentStatuses,
  deleteAgentWorkspace,
  ensureAgentWorkspace,
  listUserAgentWorkspaces,
} from '../services/app-spec/workspaces'
import {
  getAppOwnedTeam,
  getAppUser,
  listAppOwnedTeamMembers,
  listAppOwnedTeams,
  upsertAppOwnedTeam,
  upsertAppUser,
} from '../services/db/app-users'
import { ensurePlatformToken } from '../services/db/shares'
import { type Team, addTeamMember } from '../services/db/teams'
import type { User } from '../services/db/types'
import { deleteUser } from '../services/db/users'
import { issueAppUserToken } from '../services/oauth-provider'
import {
  ConflictError,
  InvalidInputError,
  MAX_SKILL_PACKAGE_BYTES,
} from '../services/skills-errors'
import { deleteTeam, removeTeamMember } from '../services/teams'

// Application protocol (/apps/v1/*). An application registered under
// /api/applications provisions its own users here and obtains short-lived
// tokens to call the rest of the API as each of them, groups them into teams,
// and publishes the prompts and skills its users' agents use. Every route is
// scoped to the calling application: an external id or a name another
// application uses, or a NAP account, is simply not found.
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
    "cannot sign in to NAP; it joins the application's team. Call it " +
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

// ── Teams ──────────────────────────────────────────────────────────────────
// Teams the application groups its users into, named by its own id for each.
// Only its users can be members, and only the application changes them. A
// user shares a folder with such a team the way they would with any team;
// providers, skills and the rest an administrator shares come through the
// application's own team, which every one of its users is in.

const TeamExternalIdParam = z.object({
  external_id: z
    .string()
    .regex(/^[A-Za-z0-9._@+-]{1,128}$/)
    .openapi({
      param: { name: 'external_id', in: 'path' },
      description: "The application's own id for the team",
    }),
})

const TeamMemberParams = TeamExternalIdParam.extend({
  user_external_id: z
    .string()
    .regex(/^[A-Za-z0-9._@+-]{1,128}$/)
    .openapi({
      param: { name: 'user_external_id', in: 'path' },
      description: "The application's own id for the user",
    }),
})

const AppTeamSchema = z
  .object({
    id: z.string().openapi({ description: 'NAP team id, as the rest of the API names it' }),
    external_id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    created_at: z.string(),
  })
  .openapi('AppTeam')

function toAppTeam(team: Team): z.infer<typeof AppTeamSchema> {
  return {
    id: team.id,
    external_id: team.external_id ?? '',
    name: team.name,
    description: team.description,
    created_at: new Date(team.created_at).toISOString(),
  }
}

// ── GET /v1/teams ──────────────────────────────────────────────────────────
const listTeamsRoute = createRoute({
  method: 'get',
  path: '/v1/teams',
  tags: ['apps'],
  summary: "List the application's teams",
  security: [{ appClientAuth: [] }],
  responses: {
    200: {
      description: 'Teams',
      content: {
        'application/json': {
          schema: z.array(AppTeamSchema.extend({ member_count: z.number().int() })),
        },
      },
    },
  },
})

apps.openapi(listTeamsRoute, async (c) => {
  const { clientId } = c.get('appPrincipal')
  const teams = await listAppOwnedTeams(clientId)
  return c.json(
    teams.map((t) => ({ ...toAppTeam(t), member_count: t.member_count })),
    200,
  )
})

// ── PUT /v1/teams/{external_id} ────────────────────────────────────────────
const upsertTeamRoute = createRoute({
  method: 'put',
  path: '/v1/teams/{external_id}',
  tags: ['apps'],
  summary: 'Create a team of the application, or update its name and description',
  description: 'Idempotent. The team starts with no members.',
  security: [{ appClientAuth: [] }],
  request: {
    params: TeamExternalIdParam,
    body: {
      content: {
        'application/json': {
          schema: z.object({
            name: z.string().trim().min(1).max(200),
            description: z.string().max(2000).nullable().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'The team already existed and was updated',
      content: { 'application/json': { schema: AppTeamSchema } },
    },
    201: {
      description: 'The team was created',
      content: { 'application/json': { schema: AppTeamSchema } },
    },
  },
})

apps.openapi(upsertTeamRoute, async (c) => {
  const { clientId } = c.get('appPrincipal')
  const { external_id } = c.req.valid('param')
  const body = c.req.valid('json')
  const { team, created } = await upsertAppOwnedTeam(
    clientId,
    external_id,
    body.name,
    body.description ?? null,
  )
  return c.json(toAppTeam(team), created ? 201 : 200)
})

// ── DELETE /v1/teams/{external_id} ─────────────────────────────────────────
const deleteTeamRoute = createRoute({
  method: 'delete',
  path: '/v1/teams/{external_id}',
  tags: ['apps'],
  summary: 'Delete a team of the application',
  description: 'Folders shared with the team stop being mounted through it.',
  security: [{ appClientAuth: [] }],
  request: { params: TeamExternalIdParam },
  responses: {
    200: {
      description: 'Deleted',
      content: { 'application/json': { schema: SuccessSchema } },
    },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

apps.openapi(deleteTeamRoute, async (c) => {
  const { clientId } = c.get('appPrincipal')
  const { external_id } = c.req.valid('param')
  const team = await getAppOwnedTeam(clientId, external_id)
  if (!team || !(await deleteTeam(team.id))) return c.json({ error: 'Team not found' }, 404)
  return c.json({ success: true }, 200)
})

// ── GET /v1/teams/{external_id}/members ────────────────────────────────────
const listTeamMembersRoute = createRoute({
  method: 'get',
  path: '/v1/teams/{external_id}/members',
  tags: ['apps'],
  summary: 'List the members of a team of the application',
  security: [{ appClientAuth: [] }],
  request: { params: TeamExternalIdParam },
  responses: {
    200: {
      description: 'Members',
      content: { 'application/json': { schema: z.array(AppUserSchema) } },
    },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

apps.openapi(listTeamMembersRoute, async (c) => {
  const { clientId } = c.get('appPrincipal')
  const { external_id } = c.req.valid('param')
  const team = await getAppOwnedTeam(clientId, external_id)
  if (!team) return c.json({ error: 'Team not found' }, 404)
  const members = await listAppOwnedTeamMembers(clientId, team.id)
  return c.json(
    members.map((m) => toAppUser(m.user, m.externalId)),
    200,
  )
})

// ── PUT /v1/teams/{external_id}/members/{user_external_id} ─────────────────
const addTeamMemberRoute = createRoute({
  method: 'put',
  path: '/v1/teams/{external_id}/members/{user_external_id}',
  tags: ['apps'],
  summary: 'Add a user of the application to one of its teams',
  description: 'Idempotent. Provision the user first.',
  security: [{ appClientAuth: [] }],
  request: { params: TeamMemberParams },
  responses: {
    200: {
      description: 'The user is a member',
      content: { 'application/json': { schema: SuccessSchema } },
    },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

apps.openapi(addTeamMemberRoute, async (c) => {
  const { clientId } = c.get('appPrincipal')
  const { external_id, user_external_id } = c.req.valid('param')
  const team = await getAppOwnedTeam(clientId, external_id)
  if (!team) return c.json({ error: 'Team not found' }, 404)
  const user = await getAppUser(clientId, user_external_id)
  if (!user) return c.json({ error: 'User not found' }, 404)
  await addTeamMember(team.id, user.id)
  return c.json({ success: true }, 200)
})

// ── DELETE /v1/teams/{external_id}/members/{user_external_id} ──────────────
const removeTeamMemberRoute = createRoute({
  method: 'delete',
  path: '/v1/teams/{external_id}/members/{user_external_id}',
  tags: ['apps'],
  summary: 'Remove a user from a team of the application',
  description:
    'Folders the user shared with the team stop being shared with it, and folders ' +
    'the user mounted through the team are unmounted.',
  security: [{ appClientAuth: [] }],
  request: { params: TeamMemberParams },
  responses: {
    200: {
      description: 'Removed',
      content: { 'application/json': { schema: SuccessSchema } },
    },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

apps.openapi(removeTeamMemberRoute, async (c) => {
  const { clientId } = c.get('appPrincipal')
  const { external_id, user_external_id } = c.req.valid('param')
  const team = await getAppOwnedTeam(clientId, external_id)
  if (!team) return c.json({ error: 'Team not found' }, 404)
  const user = await getAppUser(clientId, user_external_id)
  if (!user || !(await removeTeamMember(team.id, user.id))) {
    return c.json({ error: 'Member not found' }, 404)
  }
  return c.json({ success: true }, 200)
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

// ── Spec ───────────────────────────────────────────────────────────────────
// The document declaring the application's agents. Each is a template the
// application owns; its users' workspaces are created from it and follow it.

const PlanEntrySchema = z
  .object({
    agent: z.string(),
    action: z.enum(['create', 'update', 'delete', 'unchanged']),
    changes: z.array(z.string()).optional().openapi({ description: 'Fields an update changes' }),
  })
  .openapi('AppSpecPlanEntry')

const FolderPlanEntrySchema = z
  .object({
    folder: z.string(),
    action: z.enum(['create', 'update', 'delete', 'unchanged']),
    changes: z
      .array(z.string())
      .optional()
      .openapi({ description: 'What an update changes: owner, members' }),
  })
  .openapi('AppSpecFolderPlanEntry')

const ApplyResultSchema = z
  .object({
    version: z.number().int().openapi({
      description: 'The version in force after the apply, or that a dry run would create',
    }),
    hash: z.string(),
    changed: z
      .boolean()
      .openapi({ description: 'False when the spec resolves to the one already in force' }),
    plan: z.array(PlanEntrySchema),
    shared_folders: z.array(FolderPlanEntrySchema),
  })
  .openapi('AppSpecApplyResult')

const SpecErrorSchema = z.object({ error: z.string(), issues: z.array(z.string()) })

const FlagQuery = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => v === 'true')

// ── PUT /v1/spec ───────────────────────────────────────────────────────────
const putSpecRoute = createRoute({
  method: 'put',
  path: '/v1/spec',
  tags: ['apps'],
  summary: "Apply the application's spec",
  description:
    'The body is the whole spec, as JSON or as YAML (`Content-Type: application/yaml`). ' +
    'References to prompts, skills, providers and environments are resolved now, and a ' +
    'prompt without a version is pinned to its current one. Applying a spec that resolves ' +
    'to the one in force changes nothing. `dry_run` returns the plan only; a spec that ' +
    'drops agents is refused unless `prune` is given, which deletes them. So is one that ' +
    "drops a shared folder or gives it another owner: `prune` revokes each user's copy.",
  security: [{ appClientAuth: [] }],
  request: {
    query: z.object({ dry_run: FlagQuery, prune: FlagQuery }),
  },
  responses: {
    200: {
      description: 'Applied, or planned',
      content: { 'application/json': { schema: ApplyResultSchema } },
    },
    400: {
      description: 'Not a valid spec, or a reference does not resolve',
      content: { 'application/json': { schema: SpecErrorSchema } },
    },
    409: {
      description:
        'The spec drops agents or revokes shared folders without prune, or declares a taken MCP origin',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

apps.openapi(putSpecRoute, async (c) => {
  const { clientId } = c.get('appPrincipal')
  const { dry_run, prune } = c.req.valid('query')
  try {
    const parsed = parseAppSpec(await c.req.text(), c.req.header('content-type'))
    return c.json(await applyAppSpec(clientId, parsed, { dryRun: dry_run, prune }), 200)
  } catch (err) {
    if (err instanceof SpecError) {
      return c.json({ error: 'Invalid spec', issues: err.issues }, 400)
    }
    if (err instanceof SpecConflictError) return c.json({ error: err.message }, 409)
    throw err
  }
})

// ── GET /v1/spec ───────────────────────────────────────────────────────────
const getSpecRoute = createRoute({
  method: 'get',
  path: '/v1/spec',
  tags: ['apps'],
  summary: "Get the application's spec in force",
  description:
    'The spec as locked: each prompt reference carries the version it resolved to. ' +
    'With `Accept: application/yaml` the body is the spec alone, in YAML.',
  security: [{ appClientAuth: [] }],
  responses: {
    200: {
      description: 'The spec in force',
      content: {
        'application/json': {
          schema: z
            .object({
              version: z.number().int(),
              hash: z.string(),
              applied_at: z.string(),
              spec: z.record(z.string(), z.unknown()),
            })
            .openapi('AppSpecCurrent'),
        },
        'application/yaml': { schema: z.string() },
      },
    },
    404: {
      description: 'No spec applied yet',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

apps.openapi(getSpecRoute, async (c) => {
  const { clientId } = c.get('appPrincipal')
  const current = await getCurrentSpec(clientId)
  if (!current) return c.json({ error: 'No spec applied yet' }, 404)
  const spec = current.document
  if (/yaml/i.test(c.req.header('accept') ?? '')) {
    return c.body(toYaml(spec), 200, {
      'Content-Type': 'application/yaml',
      'X-Spec-Version': String(current.version),
    })
  }
  return c.json(
    {
      version: current.version,
      hash: current.hash,
      applied_at: new Date(current.created_at).toISOString(),
      spec,
    },
    200,
  )
})

// ── GET /v1/spec/status ────────────────────────────────────────────────────
const specStatusRoute = createRoute({
  method: 'get',
  path: '/v1/spec/status',
  tags: ['apps'],
  summary: "How far the users' workspaces have followed the spec",
  description:
    'Per agent: its template version, and how many of its workspaces are on it with the ' +
    "agent's current runtime. A workspace takes a change once no turn is running in it.",
  security: [{ appClientAuth: [] }],
  responses: {
    200: {
      description: 'Status',
      content: {
        'application/json': {
          schema: z
            .object({
              version: z.number().int().nullable(),
              agents: z.array(
                z.object({
                  agent: z.string(),
                  template_version: z.number().int(),
                  workspaces: z.number().int(),
                  up_to_date: z.number().int(),
                  blocked: z.number().int().openapi({
                    description:
                      "Workspaces that can't follow the agent or have their shared folders; see each user's agents",
                  }),
                }),
              ),
            })
            .openapi('AppSpecStatus'),
        },
      },
    },
  },
})

apps.openapi(specStatusRoute, async (c) => {
  const { clientId } = c.get('appPrincipal')
  const current = await getCurrentSpec(clientId)
  return c.json({ version: current?.version ?? null, agents: await agentStatuses(clientId) }, 200)
})

// ── Agents of a user ───────────────────────────────────────────────────────
// Each user has one workspace per agent of the spec, created on first request.

const AgentParam = ExternalIdParam.extend({
  agent: z.string().openapi({ param: { name: 'agent', in: 'path' } }),
})

const AgentWorkspaceSchema = z
  .object({
    agent: z.string(),
    workspace_id: z.string(),
    status: z.string(),
    template_version: z.number().int(),
    up_to_date: z.boolean().openapi({
      description: "On the agent's latest template version, with its current runtime",
    }),
    blocked: z.string().nullable().openapi({
      description:
        "Why the workspace can't follow its agent or have its shared folders, while it can't",
    }),
  })
  .openapi('AppAgentWorkspace')

// ── GET /v1/users/{external_id}/agents ─────────────────────────────────────
const listAgentsRoute = createRoute({
  method: 'get',
  path: '/v1/users/{external_id}/agents',
  tags: ['apps'],
  summary: "List the user's agent workspaces",
  security: [{ appClientAuth: [] }],
  request: { params: ExternalIdParam },
  responses: {
    200: {
      description: 'Workspaces',
      content: { 'application/json': { schema: z.array(AgentWorkspaceSchema) } },
    },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

apps.openapi(listAgentsRoute, async (c) => {
  const { clientId } = c.get('appPrincipal')
  const { external_id } = c.req.valid('param')
  const user = await getAppUser(clientId, external_id)
  if (!user) return c.json({ error: 'User not found' }, 404)
  return c.json(await listUserAgentWorkspaces(clientId, user.id), 200)
})

// ── PUT /v1/users/{external_id}/agents/{agent} ─────────────────────────────
const ensureAgentRoute = createRoute({
  method: 'put',
  path: '/v1/users/{external_id}/agents/{agent}',
  tags: ['apps'],
  summary: "Ensure the user's workspace for an agent",
  description:
    "Idempotent. Creates the workspace from the agent's template on the first call; " +
    'afterwards returns it, bringing it up to date first when it is behind and idle. ' +
    "Either way, the user's shared folders are brought in line with the workspaces it has. " +
    'Call the API as the user (see the token route) to chat with it.',
  security: [{ appClientAuth: [] }],
  request: { params: AgentParam },
  responses: {
    200: {
      description: 'The workspace existed',
      content: { 'application/json': { schema: AgentWorkspaceSchema } },
    },
    201: {
      description: 'The workspace was created',
      content: { 'application/json': { schema: AgentWorkspaceSchema } },
    },
    404: {
      description: 'No such user, or no such agent in the spec',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    409: {
      description: 'No environment the user can use fits the agent',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

apps.openapi(ensureAgentRoute, async (c) => {
  const { clientId } = c.get('appPrincipal')
  const { external_id, agent } = c.req.valid('param')
  const user = await getAppUser(clientId, external_id)
  if (!user) return c.json({ error: 'User not found' }, 404)
  try {
    const { workspace, created } = await ensureAgentWorkspace(clientId, user, agent)
    return c.json(workspace, created ? 201 : 200)
  } catch (err) {
    if (err instanceof AgentNotFoundError) return c.json({ error: err.message }, 404)
    if (err instanceof AgentPlacementError) return c.json({ error: err.message }, 409)
    throw err
  }
})

// ── DELETE /v1/users/{external_id}/agents/{agent} ──────────────────────────
const deleteAgentRoute = createRoute({
  method: 'delete',
  path: '/v1/users/{external_id}/agents/{agent}',
  tags: ['apps'],
  summary: "Delete the user's workspace for an agent",
  security: [{ appClientAuth: [] }],
  request: { params: AgentParam },
  responses: {
    200: { description: 'Deleted', content: { 'application/json': { schema: SuccessSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

apps.openapi(deleteAgentRoute, async (c) => {
  const { clientId } = c.get('appPrincipal')
  const { external_id, agent } = c.req.valid('param')
  const user = await getAppUser(clientId, external_id)
  if (!user || !(await deleteAgentWorkspace(clientId, user.id, agent))) {
    return c.json({ error: 'Workspace not found' }, 404)
  }
  return c.json({ success: true }, 200)
})

export default apps
