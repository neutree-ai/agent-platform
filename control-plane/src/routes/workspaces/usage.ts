import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { ApiRuntimeTimelineSchema, ApiSessionUsageListSchema } from '../../../../internal/types/api'
import type { AppEnv } from '../../lib/types'
import { canAccessWorkspace } from '../../lib/workspace-access'
import { getRuntimeLogOwner, getWorkspaceTimeline } from '../../services/db/resource-usage'
import {
  getWorkspaceUsageTotals,
  listWorkspaceSessionUsage,
} from '../../services/db/workspace-usage'
import { getWorkspace } from '../../services/db/workspaces'

/** Sessions shown per workspace before the list stops being readable. */
const SESSION_LIMIT = 12

const daysQuery = z.object({
  days: z.coerce.number().int().min(7).max(365).optional().default(30),
})

const timelineQuery = daysQuery.extend({
  since: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe(
      'Start of the window (ISO 8601). When set, `days` is ignored and segments are clipped to `[since, until)`.',
    ),
  until: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe('End of the window (ISO 8601). Requires `since`; defaults to now.'),
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
  if (!workspace || !(await canAccessWorkspace(workspace, user))) {
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
    "A workspace's runtime state as timeline segments — what it was, for how long, and at which spec.",
  description:
    'Covers the last `days` days, or `[since, until)` when `since` is given. Segments are clipped to the window. A segment that is not `ongoing` never changes, so incremental readers pass the instant they last read through as `since`. A stopped or scaled-to-zero workspace keeps a segment with `replicas: 0` and its storage. A deleted workspace stays readable by its last owner; its timeline ends at the deletion.',
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ id: z.string() }), query: timelineQuery },
  responses: {
    200: {
      description: 'Runtime timeline',
      content: { 'application/json': { schema: ApiRuntimeTimelineSchema } },
    },
    400: {
      description: 'Invalid window',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    404: notFound,
  },
})

/** Whether the caller may read a workspace's timeline, including one since deleted. */
async function canReadTimeline(id: string, user: AppEnv['Variables']['user']): Promise<boolean> {
  const workspace = await getWorkspace(id)
  if (workspace) return canAccessWorkspace(workspace, user)
  return (await getRuntimeLogOwner(id)) === user.sub
}

usage.openapi(timelineRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const { days, since, until } = c.req.valid('query')
  if (until !== undefined && since === undefined) {
    return c.json({ error: '`until` requires `since`' }, 400)
  }
  if (since !== undefined && until !== undefined && Date.parse(since) >= Date.parse(until)) {
    return c.json({ error: '`since` must be before `until`' }, 400)
  }
  if (!(await canReadTimeline(id, user))) {
    return c.json({ error: 'Workspace not found' }, 404)
  }
  const window =
    since === undefined
      ? { days }
      : { since: new Date(since), until: until === undefined ? null : new Date(until) }
  return c.json({ segments: await getWorkspaceTimeline(id, window) }, 200)
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
  if (!workspace || !(await canAccessWorkspace(workspace, user))) {
    return c.json({ error: 'Workspace not found' }, 404)
  }
  return c.json({ sessions: await listWorkspaceSessionUsage(id, days, SESSION_LIMIT) }, 200)
})

export default usage
