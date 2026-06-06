import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { AppEnv } from '../../lib/types'
import { listRecentSessions } from '../../services/db/sessions'

const RecentSessionItemSchema = z.object({
  session_id: z.string(),
  workspace_id: z.string(),
  workspace_name: z.string(),
  session_name: z.string(),
  chat_status: z.string(),
  preview: z.string(),
  last_active_at: z.string(),
})

const RecentSessionsResponseSchema = z.object({
  items: z.array(RecentSessionItemSchema),
})

const recentSessionsRoute = new OpenAPIHono<AppEnv>()

const route = createRoute({
  method: 'get',
  path: '/recent-sessions',
  tags: ['me'],
  summary:
    'Cross-workspace recent active sessions for the current user. Excludes `human` (those go to the drain queue) — covers `agent` and `idle` sorted by last_active_at desc. Used by Home to power the "continue working" rail.',
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      limit: z.coerce.number().int().min(1).max(50).optional().default(12),
    }),
  },
  responses: {
    200: {
      description: 'Recent active sessions',
      content: { 'application/json': { schema: RecentSessionsResponseSchema } },
    },
  },
})

recentSessionsRoute.openapi(route, async (c) => {
  const user = c.get('user')
  const { limit } = c.req.valid('query')
  const items = await listRecentSessions(user.sub, limit)
  return c.json({ items }, 200)
})

export default recentSessionsRoute
