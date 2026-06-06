import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  ApiWorkspaceProfileSchema,
  WorkspaceProfilePayloadSchema,
} from '../../../../internal/types/api'
import type { AppEnv } from '../../lib/types'
import { getWorkspaceProfile, patchWorkspaceProfile } from '../../services/db/workspace-profile'
import { getWorkspace } from '../../services/db/workspaces'
import { canManage } from './_shared'

const profile = new OpenAPIHono<AppEnv>()

const ErrorSchema = z.object({ error: z.string() })

const WorkspaceIdParam = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' } }),
})

const getProfileRoute = createRoute({
  method: 'get',
  path: '/{id}/profile',
  tags: ['workspaces'],
  summary: 'Get workspace UI profile (client-managed jsonb)',
  security: [{ bearerAuth: [] }],
  request: { params: WorkspaceIdParam },
  responses: {
    200: {
      description: 'Profile payload',
      content: { 'application/json': { schema: ApiWorkspaceProfileSchema } },
    },
    404: {
      description: 'Workspace not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

profile.openapi(getProfileRoute, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const ws = await getWorkspace(id)
  if (!ws || !canManage(ws, user)) return c.json({ error: 'Workspace not found' }, 404)
  const payload = await getWorkspaceProfile(id)
  return c.json({ payload }, 200)
})

const patchProfileRoute = createRoute({
  method: 'patch',
  path: '/{id}/profile',
  tags: ['workspaces'],
  summary: 'Shallow-merge a partial payload into the workspace UI profile',
  security: [{ bearerAuth: [] }],
  request: {
    params: WorkspaceIdParam,
    body: { content: { 'application/json': { schema: WorkspaceProfilePayloadSchema } } },
  },
  responses: {
    200: {
      description: 'Merged profile payload',
      content: { 'application/json': { schema: ApiWorkspaceProfileSchema } },
    },
    404: {
      description: 'Workspace not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

profile.openapi(patchProfileRoute, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const ws = await getWorkspace(id)
  if (!ws || !canManage(ws, user)) return c.json({ error: 'Workspace not found' }, 404)
  const patch = c.req.valid('json')
  const payload = await patchWorkspaceProfile(id, patch)
  return c.json({ payload }, 200)
})

export default profile
