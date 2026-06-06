import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { AppEnv } from '../../lib/types'
import { getWorkspaceUsageTotals } from '../../services/db/workspace-usage'
import { getWorkspace } from '../../services/db/workspaces'
import { canManage } from './_shared'

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

export default usage
