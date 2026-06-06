import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { ApiTeamInvitePreviewSchema } from '../../../internal/types/api'
import type { AppEnv } from '../lib/types'
import { getTeamInviteByToken } from '../services/db/team-invites'
import { addTeamMember, getTeam, getTeamMembership } from '../services/db/teams'
import { getUser } from '../services/db/users'

const invites = new OpenAPIHono<AppEnv>()

const ErrorSchema = z.object({ error: z.string() })

const TokenParam = z.object({
  token: z.string().openapi({ param: { name: 'token', in: 'path' } }),
})

function isExpired(expiresAt: Date | null): boolean {
  if (!expiresAt) return false
  return expiresAt.getTime() <= Date.now()
}

// ── GET /:token ────────────────────────────────────────────────────────────
// Preview an invite. Any authenticated user can call this; the response says
// what team the link goes to and whether the caller is already a member.
const previewRoute = createRoute({
  method: 'get',
  path: '/{token}',
  tags: ['invites'],
  summary: 'Preview an invite link before accepting',
  security: [{ bearerAuth: [] }],
  request: { params: TokenParam },
  responses: {
    200: {
      description: 'Invite preview',
      content: { 'application/json': { schema: ApiTeamInvitePreviewSchema } },
    },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    410: { description: 'Expired', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

invites.openapi(previewRoute, async (c) => {
  const user = c.get('user')
  const { token } = c.req.valid('param')
  const invite = await getTeamInviteByToken(token)
  if (!invite) return c.json({ error: 'Invite not found' }, 404)
  if (isExpired(invite.expires_at)) return c.json({ error: 'Invite expired' }, 410)
  const team = await getTeam(invite.team_id)
  if (!team) return c.json({ error: 'Invite not found' }, 404)
  const inviter = await getUser(invite.created_by)
  const membership = await getTeamMembership(team.id, user.sub)
  return c.json(
    {
      team_id: team.id,
      team_name: team.name,
      inviter_name: inviter?.display_name ?? '',
      expires_at: invite.expires_at instanceof Date ? invite.expires_at.toISOString() : null,
      already_member: !!membership,
    },
    200,
  )
})

// ── POST /:token/accept ────────────────────────────────────────────────────
// Idempotent: accepting when already a member returns success with
// already_member=true. Otherwise the caller is added as a regular member.
const acceptRoute = createRoute({
  method: 'post',
  path: '/{token}/accept',
  tags: ['invites'],
  summary: 'Accept an invite link and join the team',
  security: [{ bearerAuth: [] }],
  request: { params: TokenParam },
  responses: {
    200: {
      description: 'Joined (or already a member)',
      content: {
        'application/json': {
          schema: z.object({ team_id: z.string(), already_member: z.boolean() }),
        },
      },
    },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    410: { description: 'Expired', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

invites.openapi(acceptRoute, async (c) => {
  const user = c.get('user')
  const { token } = c.req.valid('param')
  const invite = await getTeamInviteByToken(token)
  if (!invite) return c.json({ error: 'Invite not found' }, 404)
  if (isExpired(invite.expires_at)) return c.json({ error: 'Invite expired' }, 410)
  const team = await getTeam(invite.team_id)
  if (!team) return c.json({ error: 'Invite not found' }, 404)

  const existing = await getTeamMembership(team.id, user.sub)
  if (existing) {
    return c.json({ team_id: team.id, already_member: true }, 200)
  }
  await addTeamMember(team.id, user.sub, 'member')
  return c.json({ team_id: team.id, already_member: false }, 200)
})

export default invites
