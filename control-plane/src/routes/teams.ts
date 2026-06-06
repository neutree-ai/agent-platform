import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  ApiTeamInviteSchema,
  ApiTeamMemberSchema,
  ApiTeamSchema,
  TeamCreateBodySchema,
  TeamInviteCreateBodySchema,
  TeamMemberAddBodySchema,
  TeamMemberPatchBodySchema,
  TeamPatchBodySchema,
} from '../../../internal/types/api'
import type { AppEnv } from '../lib/types'
import { createTeamInvite, deleteTeamInvite, listTeamInvites } from '../services/db/team-invites'
import {
  type Team,
  type TeamMemberWithUser,
  type TeamRole,
  type TeamSummary,
  addTeamMember,
  createTeam,
  deleteTeam,
  getTeam,
  getTeamMembership,
  listTeamMembers,
  listTeamsForUser,
  removeTeamMember,
  updateTeam,
  updateTeamMemberRole,
} from '../services/db/teams'
import { getUser } from '../services/db/users'

const teams = new OpenAPIHono<AppEnv>()

const ErrorSchema = z.object({ error: z.string() })
const SuccessSchema = z.object({ success: z.boolean() })

const IdParam = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' } }),
})

const MemberParam = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' } }),
  userId: z.string().openapi({ param: { name: 'userId', in: 'path' } }),
})

function toApiTeam(t: TeamSummary): z.infer<typeof ApiTeamSchema> {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    created_by: t.created_by,
    created_at: t.created_at instanceof Date ? t.created_at.toISOString() : String(t.created_at),
    updated_at: t.updated_at instanceof Date ? t.updated_at.toISOString() : String(t.updated_at),
    my_role: t.my_role,
    member_count: t.member_count,
  }
}

function toApiTeamFromMembership(t: Team, role: TeamRole, memberCount: number) {
  return toApiTeam({ ...t, my_role: role, member_count: memberCount })
}

function toApiMember(m: TeamMemberWithUser): z.infer<typeof ApiTeamMemberSchema> {
  return {
    user_id: m.user_id,
    user_name: m.user_name,
    role: m.role,
    joined_at: m.joined_at instanceof Date ? m.joined_at.toISOString() : String(m.joined_at),
  }
}

// ── GET / ──────────────────────────────────────────────────────────────────
const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['teams'],
  summary: 'List teams the current user is a member of',
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Teams',
      content: { 'application/json': { schema: z.array(ApiTeamSchema) } },
    },
  },
})

teams.openapi(listRoute, async (c) => {
  const user = c.get('user')
  const rows = await listTeamsForUser(user.sub)
  return c.json(rows.map(toApiTeam), 200)
})

// ── POST / ─────────────────────────────────────────────────────────────────
const createRouteDef = createRoute({
  method: 'post',
  path: '/',
  tags: ['teams'],
  summary: 'Create a team. The creator becomes its first admin.',
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { 'application/json': { schema: TeamCreateBodySchema } } },
  },
  responses: {
    201: {
      description: 'Created team',
      content: { 'application/json': { schema: ApiTeamSchema } },
    },
  },
})

teams.openapi(createRouteDef, async (c) => {
  const user = c.get('user')
  const body = c.req.valid('json')
  const team = await createTeam(user.sub, body.name, body.description)
  return c.json(toApiTeamFromMembership(team, 'admin', 1), 201)
})

// ── GET /:id ───────────────────────────────────────────────────────────────
const getRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['teams'],
  summary: 'Get team detail (members only)',
  security: [{ bearerAuth: [] }],
  request: { params: IdParam },
  responses: {
    200: { description: 'Team', content: { 'application/json': { schema: ApiTeamSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

teams.openapi(getRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const team = await getTeam(id)
  if (!team) return c.json({ error: 'Team not found' }, 404)
  const membership = await getTeamMembership(id, user.sub)
  if (!membership) return c.json({ error: 'Team not found' }, 404)
  const members = await listTeamMembers(id)
  return c.json(toApiTeamFromMembership(team, membership.role, members.length), 200)
})

// ── PATCH /:id ─────────────────────────────────────────────────────────────
const patchRoute = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['teams'],
  summary: 'Update team name/description (admin only)',
  security: [{ bearerAuth: [] }],
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: TeamPatchBodySchema } } },
  },
  responses: {
    200: { description: 'Updated', content: { 'application/json': { schema: ApiTeamSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

teams.openapi(patchRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const body = c.req.valid('json')
  const membership = await getTeamMembership(id, user.sub)
  if (!membership) return c.json({ error: 'Team not found' }, 404)
  if (membership.role !== 'admin') return c.json({ error: 'Admin only' }, 403)
  const updated = await updateTeam(id, body)
  if (!updated) return c.json({ error: 'Team not found' }, 404)
  const members = await listTeamMembers(id)
  return c.json(toApiTeamFromMembership(updated, membership.role, members.length), 200)
})

// ── DELETE /:id ────────────────────────────────────────────────────────────
const deleteRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['teams'],
  summary: 'Delete a team (admin only). Cascades to team_members and grants.',
  security: [{ bearerAuth: [] }],
  request: { params: IdParam },
  responses: {
    200: { description: 'Deleted', content: { 'application/json': { schema: SuccessSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

teams.openapi(deleteRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const membership = await getTeamMembership(id, user.sub)
  if (!membership) return c.json({ error: 'Team not found' }, 404)
  if (membership.role !== 'admin') return c.json({ error: 'Admin only' }, 403)
  const ok = await deleteTeam(id)
  if (!ok) return c.json({ error: 'Team not found' }, 404)
  return c.json({ success: true }, 200)
})

// ── GET /:id/members ───────────────────────────────────────────────────────
const listMembersRoute = createRoute({
  method: 'get',
  path: '/{id}/members',
  tags: ['teams'],
  summary: 'List team members (members only)',
  security: [{ bearerAuth: [] }],
  request: { params: IdParam },
  responses: {
    200: {
      description: 'Members',
      content: { 'application/json': { schema: z.array(ApiTeamMemberSchema) } },
    },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

teams.openapi(listMembersRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const membership = await getTeamMembership(id, user.sub)
  if (!membership) return c.json({ error: 'Team not found' }, 404)
  const members = await listTeamMembers(id)
  return c.json(members.map(toApiMember), 200)
})

// ── POST /:id/members ──────────────────────────────────────────────────────
const addMemberRoute = createRoute({
  method: 'post',
  path: '/{id}/members',
  tags: ['teams'],
  summary: 'Add a user to the team (admin only)',
  security: [{ bearerAuth: [] }],
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: TeamMemberAddBodySchema } } },
  },
  responses: {
    201: {
      description: 'Added',
      content: { 'application/json': { schema: ApiTeamMemberSchema } },
    },
    400: { description: 'Bad request', content: { 'application/json': { schema: ErrorSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

teams.openapi(addMemberRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const body = c.req.valid('json')
  const membership = await getTeamMembership(id, user.sub)
  if (!membership) return c.json({ error: 'Team not found' }, 404)
  if (membership.role !== 'admin') return c.json({ error: 'Admin only' }, 403)

  const target = await getUser(body.user_id)
  if (!target) return c.json({ error: 'User not found' }, 400)

  await addTeamMember(id, body.user_id, body.role ?? 'member')
  const added = await getTeamMembership(id, body.user_id)
  if (!added) return c.json({ error: 'Failed to add member' }, 400)
  return c.json(
    toApiMember({
      ...added,
      user_name: target.display_name ?? target.username,
    }),
    201,
  )
})

// ── PATCH /:id/members/:userId ─────────────────────────────────────────────
const patchMemberRoute = createRoute({
  method: 'patch',
  path: '/{id}/members/{userId}',
  tags: ['teams'],
  summary: "Change a member's role (admin only)",
  security: [{ bearerAuth: [] }],
  request: {
    params: MemberParam,
    body: { content: { 'application/json': { schema: TeamMemberPatchBodySchema } } },
  },
  responses: {
    200: { description: 'Updated', content: { 'application/json': { schema: SuccessSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    409: { description: 'Conflict', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

teams.openapi(patchMemberRoute, async (c) => {
  const user = c.get('user')
  const { id, userId } = c.req.valid('param')
  const body = c.req.valid('json')
  const membership = await getTeamMembership(id, user.sub)
  if (!membership) return c.json({ error: 'Team not found' }, 404)
  if (membership.role !== 'admin') return c.json({ error: 'Admin only' }, 403)

  // Prevent demoting the last admin so a team can never become unmanageable.
  if (body.role !== 'admin') {
    const members = await listTeamMembers(id)
    const admins = members.filter((m) => m.role === 'admin')
    if (admins.length === 1 && admins[0].user_id === userId) {
      return c.json({ error: 'Cannot demote the last admin' }, 409)
    }
  }

  const ok = await updateTeamMemberRole(id, userId, body.role)
  if (!ok) return c.json({ error: 'Member not found' }, 404)
  return c.json({ success: true }, 200)
})

// ── DELETE /:id/members/:userId ────────────────────────────────────────────
const removeMemberRoute = createRoute({
  method: 'delete',
  path: '/{id}/members/{userId}',
  tags: ['teams'],
  summary: 'Remove a member. Admins can remove anyone; users can remove themselves.',
  security: [{ bearerAuth: [] }],
  request: { params: MemberParam },
  responses: {
    200: { description: 'Removed', content: { 'application/json': { schema: SuccessSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    409: { description: 'Conflict', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

teams.openapi(removeMemberRoute, async (c) => {
  const user = c.get('user')
  const { id, userId } = c.req.valid('param')
  const membership = await getTeamMembership(id, user.sub)
  if (!membership) return c.json({ error: 'Team not found' }, 404)
  const isSelf = userId === user.sub
  if (!isSelf && membership.role !== 'admin') return c.json({ error: 'Admin only' }, 403)

  // Don't let the last admin walk out and orphan the team.
  const target = await getTeamMembership(id, userId)
  if (!target) return c.json({ error: 'Member not found' }, 404)
  if (target.role === 'admin') {
    const members = await listTeamMembers(id)
    const admins = members.filter((m) => m.role === 'admin')
    if (admins.length === 1) {
      return c.json({ error: 'Cannot remove the last admin; delete the team instead' }, 409)
    }
  }

  const ok = await removeTeamMember(id, userId)
  if (!ok) return c.json({ error: 'Member not found' }, 404)
  return c.json({ success: true }, 200)
})

// ── Invite management (admin only) ─────────────────────────────────────────
// Anyone with a valid invite link can join the team. Admins create / revoke
// links here; the join + preview side lives at /api/invites/{token}.

async function loadTeamInvites(teamId: string) {
  const rows = await listTeamInvites(teamId)
  if (rows.length === 0) return []
  const creators = await Promise.all(rows.map((r) => getUser(r.created_by)))
  return rows.map((row, i) => ({
    token: row.token,
    team_id: row.team_id,
    created_by: row.created_by,
    created_by_name: creators[i]?.display_name ?? '',
    expires_at:
      row.expires_at instanceof Date
        ? row.expires_at.toISOString()
        : row.expires_at
          ? String(row.expires_at)
          : null,
    created_at:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  }))
}

const listInvitesRoute = createRoute({
  method: 'get',
  path: '/{id}/invites',
  tags: ['teams'],
  summary: 'List active (non-expired) invite links for a team (admin only)',
  security: [{ bearerAuth: [] }],
  request: { params: IdParam },
  responses: {
    200: {
      description: 'Invites',
      content: { 'application/json': { schema: z.array(ApiTeamInviteSchema) } },
    },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

teams.openapi(listInvitesRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const membership = await getTeamMembership(id, user.sub)
  if (!membership) return c.json({ error: 'Team not found' }, 404)
  if (membership.role !== 'admin') return c.json({ error: 'Admin only' }, 403)
  const invites = await loadTeamInvites(id)
  return c.json(invites, 200)
})

const createInviteRoute = createRoute({
  method: 'post',
  path: '/{id}/invites',
  tags: ['teams'],
  summary: 'Create an invite link (admin only). Default expiry 7 days.',
  security: [{ bearerAuth: [] }],
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: TeamInviteCreateBodySchema } } },
  },
  responses: {
    201: {
      description: 'Created',
      content: { 'application/json': { schema: ApiTeamInviteSchema } },
    },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

teams.openapi(createInviteRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const body = c.req.valid('json')
  const membership = await getTeamMembership(id, user.sub)
  if (!membership) return c.json({ error: 'Team not found' }, 404)
  if (membership.role !== 'admin') return c.json({ error: 'Admin only' }, 403)
  const days = body.expires_in_days ?? 7
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
  const created = await createTeamInvite(id, user.sub, expiresAt)
  const me = await getUser(user.sub)
  return c.json(
    {
      token: created.token,
      team_id: created.team_id,
      created_by: created.created_by,
      created_by_name: me?.display_name ?? '',
      expires_at: created.expires_at instanceof Date ? created.expires_at.toISOString() : null,
      created_at:
        created.created_at instanceof Date
          ? created.created_at.toISOString()
          : String(created.created_at),
    },
    201,
  )
})

const TokenParam = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' } }),
  token: z.string().openapi({ param: { name: 'token', in: 'path' } }),
})

const deleteInviteRoute = createRoute({
  method: 'delete',
  path: '/{id}/invites/{token}',
  tags: ['teams'],
  summary: 'Revoke an invite link (admin only)',
  security: [{ bearerAuth: [] }],
  request: { params: TokenParam },
  responses: {
    200: { description: 'Revoked', content: { 'application/json': { schema: SuccessSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

teams.openapi(deleteInviteRoute, async (c) => {
  const user = c.get('user')
  const { id, token } = c.req.valid('param')
  const membership = await getTeamMembership(id, user.sub)
  if (!membership) return c.json({ error: 'Team not found' }, 404)
  if (membership.role !== 'admin') return c.json({ error: 'Admin only' }, 403)
  const ok = await deleteTeamInvite(token)
  if (!ok) return c.json({ error: 'Invite not found' }, 404)
  return c.json({ success: true }, 200)
})

export default teams
