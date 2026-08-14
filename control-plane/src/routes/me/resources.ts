import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { ApiResourceSummarySchema } from '../../../../internal/types/api'
import type { AppEnv } from '../../lib/types'
import { getUserComputeUsage, listUserWorkspaceFootprints } from '../../services/db/resource-usage'
import { summarizeFootprints } from '../../services/resource-usage'

/**
 * Days without activity before a running workspace is called idle. Deliberately
 * shorter than a cluster's idle GC would be set to: this surfaces the workspace
 * to its owner while stopping it is still their call.
 */
const IDLE_DAYS = 3

const resources = new OpenAPIHono<AppEnv>()

const route = createRoute({
  method: 'get',
  path: '/resource-summary',
  tags: ['me'],
  summary:
    "Per-user resource footprint — compute core-hours over the last `days` days (daily and per workspace), the share of it currently going to idle workspaces, and the disks the user's workspaces hold.",
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      days: z.coerce.number().int().min(7).max(365).optional().default(30),
    }),
  },
  responses: {
    200: {
      description: 'Resource summary',
      content: { 'application/json': { schema: ApiResourceSummarySchema } },
    },
  },
})

resources.openapi(route, async (c) => {
  const user = c.get('user')
  const { days } = c.req.valid('query')
  const [compute, footprints] = await Promise.all([
    getUserComputeUsage(user.sub, days),
    listUserWorkspaceFootprints(user.sub),
  ])
  const { idleCoreHoursByWorkspace, ...windowTotals } = compute
  const { idle, storage } = summarizeFootprints(footprints, idleCoreHoursByWorkspace, {
    idleDays: IDLE_DAYS,
  })

  return c.json(
    {
      compute: {
        ...windowTotals,
        idleCoreHours: idle.reduce((sum, w) => sum + w.coreHours, 0),
      },
      idle,
      storage,
    },
    200,
  )
})

export default resources
