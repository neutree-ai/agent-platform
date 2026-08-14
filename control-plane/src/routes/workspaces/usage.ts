import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { ApiRuntimeTimelineSchema, ApiSessionUsageListSchema } from '../../../../internal/types/api'
import type { AppEnv } from '../../lib/types'
import { getWorkspaceTimeline } from '../../services/db/resource-usage'
import {
  getWorkspaceUsageTotals,
  listWorkspaceSessionUsage,
} from '../../services/db/workspace-usage'
import { getWorkspace } from '../../services/db/workspaces'
import { canManage } from './_shared'

/** Sessions shown per workspace before the list stops being readable. */
const SESSION_LIMIT = 12

const daysQuery = z.object({
  days: z.coerce.number().int().min(7).max(365).optional().default(30),
})

const notFound = {
  description: 'Workspace not found',
  content: { 'application/json': { schema: z.object({ error: z.string() }) } },
}

const usage = new OpenAPIHono<AppEnv>()

const UsageTotalsSchema = z.object({
  workspace_id: z.string(),
  input_tokens: z.number(),
  output_tokens: z.number(),
  cache_read_tokens: z.number(),
  cache_creation_tokens: z.number(),
  reasoning_output_tokens: z.number(),
  web_search_requests: z.number(),
  record_count: z.number(),
  last_used_at: z.string().nullable(),
})

const getUsageRoute = createRoute({
  method: 'get',
  path: '/{id}/usage',
  tags: ['workspaces'],
  summary: 'Get aggregate token usage for a workspace',
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'Workspace usage totals',
      content: { 'application/json': { schema: UsageTotalsSchema } },
    },
    404: {
      description: 'Workspace not found',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

usage.openapi(getUsageRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const workspace = await getWorkspace(id)
  if (!workspace || !canManage(workspace, user)) {
    return c.json({ error: 'Workspace not found' }, 404)
  }
  const totals = await getWorkspaceUsageTotals(id)
  return c.json({ workspace_id: id, ...totals }, 200)
})

const timelineRoute = createRoute({
  method: 'get',
  path: '/{id}/runtime-timeline',
  tags: ['workspaces'],
  summary:
    "A workspace's runtime state as timeline segments over the last `days` days — what it was, for how long, and at which spec.",
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ id: z.string() }), query: daysQuery },
  responses: {
    200: {
      description: 'Runtime timeline',
      content: { 'application/json': { schema: ApiRuntimeTimelineSchema } },
    },
    404: notFound,
  },
})

usage.openapi(timelineRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const { days } = c.req.valid('query')
  const workspace = await getWorkspace(id)
  if (!workspace || !canManage(workspace, user)) {
    return c.json({ error: 'Workspace not found' }, 404)
  }
  return c.json({ segments: await getWorkspaceTimeline(id, days) }, 200)
})

const sessionUsageRoute = createRoute({
  method: 'get',
  path: '/{id}/session-usage',
  tags: ['workspaces'],
  summary:
    "A workspace's top sessions by token spend over the last `days` days, each with its message count, tool-call count and wall-clock duration.",
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ id: z.string() }), query: daysQuery },
  responses: {
    200: {
      description: 'Session usage',
      content: { 'application/json': { schema: ApiSessionUsageListSchema } },
    },
    404: notFound,
  },
})

usage.openapi(sessionUsageRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const { days } = c.req.valid('query')
  const workspace = await getWorkspace(id)
  if (!workspace || !canManage(workspace, user)) {
    return c.json({ error: 'Workspace not found' }, 404)
  }
  return c.json({ sessions: await listWorkspaceSessionUsage(id, days, SESSION_LIMIT) }, 200)
})

export default usage
