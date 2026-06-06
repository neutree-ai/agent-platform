import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  AgentRequestResolveBodySchema,
  ApiAgentRequestSchema,
} from '../../../../internal/types/api'
import type { AppEnv } from '../../lib/types'
import { getAgentRequest, resolveAgentRequest } from '../../services/db/agent-requests'
import { getWorkspace } from '../../services/db/workspaces'

const agentRequests = new OpenAPIHono<AppEnv>()

const ErrorSchema = z.object({ error: z.string() })

const AgentRequestParam = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' } }),
  reqId: z.string().openapi({ param: { name: 'reqId', in: 'path' } }),
})

// ── GET /:id/agent-requests/:reqId ─────────────────────────────────────────
const getRoute = createRoute({
  method: 'get',
  path: '/{id}/agent-requests/{reqId}',
  tags: ['workspaces'],
  summary: 'Read a single agent_request for human-in-loop review.',
  security: [{ bearerAuth: [] }],
  request: { params: AgentRequestParam },
  responses: {
    200: {
      description: 'Request',
      content: { 'application/json': { schema: ApiAgentRequestSchema } },
    },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

agentRequests.openapi(getRoute, async (c) => {
  const user = c.get('user')
  const { id, reqId } = c.req.valid('param')

  const workspace = await getWorkspace(id)
  if (!workspace || workspace.user_id !== user.sub) {
    return c.json({ error: 'Workspace not found' }, 404)
  }

  const req = await getAgentRequest(reqId)
  if (!req || req.workspace_id !== id) {
    return c.json({ error: 'Request not found' }, 404)
  }
  return c.json(req, 200)
})

// ── POST /:id/agent-requests/:reqId/resolve ────────────────────────────────
const resolveRoute = createRoute({
  method: 'post',
  path: '/{id}/agent-requests/{reqId}/resolve',
  tags: ['workspaces'],
  summary: 'Approve or reject a pending agent_request.',
  security: [{ bearerAuth: [] }],
  request: {
    params: AgentRequestParam,
    body: { content: { 'application/json': { schema: AgentRequestResolveBodySchema } } },
  },
  responses: {
    200: {
      description: 'Resolved',
      content: { 'application/json': { schema: ApiAgentRequestSchema } },
    },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    409: {
      description: 'Already resolved',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

agentRequests.openapi(resolveRoute, async (c) => {
  const user = c.get('user')
  const { id, reqId } = c.req.valid('param')
  const { decision, reason } = c.req.valid('json')

  const workspace = await getWorkspace(id)
  if (!workspace || workspace.user_id !== user.sub) {
    return c.json({ error: 'Workspace not found' }, 404)
  }

  const existing = await getAgentRequest(reqId)
  if (!existing || existing.workspace_id !== id) {
    return c.json({ error: 'Request not found' }, 404)
  }
  if (existing.status !== 'pending') {
    return c.json({ error: 'Request already resolved' }, 409)
  }

  const updated = await resolveAgentRequest(reqId, decision, reason)
  if (!updated) {
    // Race: another resolve won the CAS between our read and write.
    return c.json({ error: 'Request already resolved' }, 409)
  }
  return c.json(updated, 200)
})

export default agentRequests
