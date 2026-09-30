import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { ApiWorkspaceTeamShareSchema } from '../../../../internal/types/api'
import type { AppEnv } from '../../lib/types'
import { canAccessWorkspace, isWorkspaceOwner } from '../../lib/workspace-access'
import { getTeamMembership } from '../../services/db/teams'
import {
  addWorkspaceTeamShare,
  listWorkspaceTeamShares,
  removeWorkspaceTeamShare,
} from '../../services/db/workspace-shares'
import { getWorkspace } from '../../services/db/workspaces'

// Sharing a workspace with teams. Members of a shared team can use and manage
// the workspace; the agent still runs as the owner. Only the owner shares and
// revokes, and only with teams they belong to.

const teamShares = new OpenAPIHono<AppEnv>()

const ErrorSchema = z.object({ error: z.string() })
const SuccessSchema = z.object({ success: z.boolean() })

const WorkspaceIdParam = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' } }),
})
const TeamShareParam = WorkspaceIdParam.extend({
  teamId: z.string().openapi({ param: { name: 'teamId', in: 'path' } }),
})

const errors = {
  403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorSchema } } },
  404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
}

function toApi(s: { team_id: string; team_name: string; created_at: Date }) {
  return {
    team_id: s.team_id,
    team_name: s.team_name,
    created_at: new Date(s.created_at).toISOString(),
  }
}

// ── GET /:id/team-shares ───────────────────────────────────────────────────

const listRoute = createRoute({
  method: 'get',
  path: '/{id}/team-shares',
  tags: ['workspaces'],
  summary: 'List the teams a workspace is shared with',
  security: [{ bearerAuth: [] }],
  request: { params: WorkspaceIdParam },
  responses: {
    200: {
      description: 'Team shares',
      content: { 'application/json': { schema: z.array(ApiWorkspaceTeamShareSchema) } },
    },
    404: errors[404],
  },
})

teamShares.openapi(listRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const workspace = await getWorkspace(id)
  if (!workspace || !(await canAccessWorkspace(workspace, user))) {
    return c.json({ error: 'Workspace not found' }, 404)
  }
  const shares = await listWorkspaceTeamShares(id)
  return c.json(shares.map(toApi), 200)
})

// ── PUT /:id/team-shares/:teamId ───────────────────────────────────────────

const shareRoute = createRoute({
  method: 'put',
  path: '/{id}/team-shares/{teamId}',
  tags: ['workspaces'],
  summary: 'Share a workspace with a team (owner only). Idempotent.',
  security: [{ bearerAuth: [] }],
  request: { params: TeamShareParam },
  responses: {
    200: { description: 'Shared', content: { 'application/json': { schema: SuccessSchema } } },
    403: errors[403],
    404: errors[404],
  },
})

teamShares.openapi(shareRoute, async (c) => {
  const user = c.get('user')
  const { id, teamId } = c.req.valid('param')
  const workspace = await getWorkspace(id)
  if (!workspace || !(await canAccessWorkspace(workspace, user))) {
    return c.json({ error: 'Workspace not found' }, 404)
  }
  if (!isWorkspaceOwner(workspace, user)) {
    return c.json({ error: 'Only the owner can share a workspace' }, 403)
  }
  if (!(await getTeamMembership(teamId, user.sub))) {
    return c.json({ error: 'Team not found' }, 404)
  }
  await addWorkspaceTeamShare(id, teamId, user.sub)
  return c.json({ success: true }, 200)
})

// ── DELETE /:id/team-shares/:teamId ────────────────────────────────────────

const revokeRoute = createRoute({
  method: 'delete',
  path: '/{id}/team-shares/{teamId}',
  tags: ['workspaces'],
  summary: 'Stop sharing a workspace with a team (owner only). Takes effect immediately.',
  security: [{ bearerAuth: [] }],
  request: { params: TeamShareParam },
  responses: {
    200: { description: 'Revoked', content: { 'application/json': { schema: SuccessSchema } } },
    403: errors[403],
    404: errors[404],
  },
})

teamShares.openapi(revokeRoute, async (c) => {
  const user = c.get('user')
  const { id, teamId } = c.req.valid('param')
  const workspace = await getWorkspace(id)
  if (!workspace || !(await canAccessWorkspace(workspace, user))) {
    return c.json({ error: 'Workspace not found' }, 404)
  }
  if (!isWorkspaceOwner(workspace, user)) {
    return c.json({ error: 'Only the owner can revoke a share' }, 403)
  }
  if (!(await removeWorkspaceTeamShare(id, teamId))) {
    return c.json({ error: 'Share not found' }, 404)
  }
  return c.json({ success: true }, 200)
})

export default teamShares
