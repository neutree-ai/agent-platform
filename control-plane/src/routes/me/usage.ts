import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { AppEnv } from '../../lib/types'
import { getUserUsageSummary } from '../../services/db/workspace-usage'

const UsageSummarySchema = z.object({
  daily: z.array(
    z.object({
      date: z.string(),
      tokens: z.number().int(),
    }),
  ),
  composition: z.object({
    input: z.number().int(),
    output: z.number().int(),
    cacheRead: z.number().int(),
    cacheCreation: z.number().int(),
  }),
  byWorkspace: z.array(
    z.object({
      workspaceId: z.string(),
      name: z.string(),
      tokens: z.number().int(),
    }),
  ),
})

const usage = new OpenAPIHono<AppEnv>()

const route = createRoute({
  method: 'get',
  path: '/usage-summary',
  tags: ['me'],
  summary:
    'Per-user token-usage summary for the Stats app — daily all-in totals, a token-kind composition, and a per-workspace breakdown over the last `days` days (default 30; capped at 365).',
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      days: z.coerce.number().int().min(7).max(365).optional().default(30),
    }),
  },
  responses: {
    200: {
      description: 'Usage summary',
      content: { 'application/json': { schema: UsageSummarySchema } },
    },
  },
})

usage.openapi(route, async (c) => {
  const user = c.get('user')
  const { days } = c.req.valid('query')
  const summary = await getUserUsageSummary(user.sub, days)
  return c.json(summary, 200)
})

export default usage
