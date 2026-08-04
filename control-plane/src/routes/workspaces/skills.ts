// Workspace skill list for the web app. The agent reads the same data from
// `/workspace/v1/workspaces/:id/skills`, which is reachable only from inside the
// cluster; this route is the browser-facing half and carries a real owner
// check, so the two callers no longer share one unauthenticated surface.

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { AppEnv } from '../../lib/types'
import { getWorkspace } from '../../services/db/workspaces'
import { skillRepo, skillsService } from '../../services/skills-composition'
import { canManage } from './_shared'

const workspaceSkills = new OpenAPIHono<AppEnv>()

const ErrorSchema = z.object({ error: z.string() })

const WorkspaceIdParam = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' } }),
})

const WorkspaceSkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  editable: z.boolean(),
  gitSource: z.boolean(),
})

const listRoute = createRoute({
  method: 'get',
  path: '/{id}/skills',
  tags: ['workspaces'],
  summary: 'List the skills attached to a workspace',
  security: [{ bearerAuth: [] }],
  request: { params: WorkspaceIdParam },
  responses: {
    200: {
      description: 'Attached skills',
      content: {
        'application/json': { schema: z.object({ skills: z.array(WorkspaceSkillSchema) }) },
      },
    },
    404: {
      description: 'Workspace not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

workspaceSkills.openapi(listRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')

  const workspace = await getWorkspace(id)
  if (!workspace || !canManage(workspace, user)) {
    return c.json({ error: 'Workspace not found' }, 404)
  }

  const rows = await skillRepo.getWorkspaceSkillsForAgent(id)
  const skills = rows.map((s) => ({
    id: s.id,
    name: s.name ?? '(unknown)',
    // A skill is editable in this workspace when the workspace owner owns it,
    // or when it has no owner at all (built-in).
    editable: s.user_id === workspace.user_id || !s.user_id,
    gitSource: s.source_kind === 'git',
  }))
  return c.json({ skills }, 200)
})

const replaceRoute = createRoute({
  method: 'put',
  path: '/{id}/skills',
  tags: ['workspaces'],
  summary: 'Replace the workspace skill set and reload the agent',
  security: [{ bearerAuth: [] }],
  request: {
    params: WorkspaceIdParam,
    body: {
      content: { 'application/json': { schema: z.object({ skills: z.array(z.string()) }) } },
    },
  },
  responses: {
    200: {
      description: 'Updated',
      content: {
        'application/json': {
          schema: z.object({ success: z.literal(true), reloaded: z.boolean() }),
        },
      },
    },
    403: {
      description: 'A requested skill is not visible to this workspace',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Workspace not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

workspaceSkills.openapi(replaceRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const body = c.req.valid('json')

  const workspace = await getWorkspace(id)
  if (!workspace || !canManage(workspace, user)) {
    return c.json({ error: 'Workspace not found' }, 404)
  }

  try {
    const { reloaded } = await skillsService.attachToWorkspace(id, body.skills)
    return c.json({ success: true as const, reloaded }, 200)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg === 'workspace not found') return c.json({ error: 'Workspace not found' }, 404)
    if (msg.startsWith('skills not visible')) return c.json({ error: msg }, 403)
    throw e
  }
})

export default workspaceSkills
