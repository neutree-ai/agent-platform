import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { AppEnv } from '../../lib/types'
import { getUserActivitySummary } from '../../services/db/sessions'

const ActivitySummarySchema = z.object({
  daily: z.array(
    z.object({
      date: z.string(),
      interactions: z.number().int(),
      sessions: z.number().int(),
    }),
  ),
  punch_card: z.array(
    z.object({
      dow: z.number().int(),
      hour: z.number().int(),
      count: z.number().int(),
    }),
  ),
})

const activity = new OpenAPIHono<AppEnv>()

const route = createRoute({
  method: 'get',
  path: '/activity-summary',
  tags: ['me'],
  summary:
    'Per-user activity summary for the Home stats sidecar — daily interactions/sessions over the last `days` days (default 30; capped at 365).',
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      days: z.coerce.number().int().min(7).max(365).optional().default(30),
    }),
  },
  responses: {
    200: {
      description: 'Activity summary',
      content: { 'application/json': { schema: ActivitySummarySchema } },
    },
  },
})

activity.openapi(route, async (c) => {
  const user = c.get('user')
  const { days } = c.req.valid('query')
  const summary = await getUserActivitySummary(user.sub, days)
  return c.json(summary, 200)
})

export default activity
