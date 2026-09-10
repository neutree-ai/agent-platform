import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { AppEnv } from '../../lib/types'
import { getStoreById, setStoreLastReflectedAt } from '../../services/db/memory'
import { getSession } from '../../services/db/sessions'
import { clearActiveReflectStoreIfMatches, getWorkspace } from '../../services/db/workspaces'
import { reflectWindow } from '../../services/reflect'

const reflect = new OpenAPIHono<AppEnv>()

const ErrorSchema = z.object({ error: z.string() })
const SuccessSchema = z.object({ success: z.boolean() })

const WorkspaceIdParam = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' } }),
})

const ReflectEndBodySchema = z.object({
  store_id: z.string(),
  session_id: z.string(),
  success: z.boolean(),
})

/**
 * Called by the scheduler once a Reflect turn's SSE stream ends (success or
 * failure) — see scheduler/src/handler.ts. Not meant for direct API use;
 * exists as an authenticated workspace route (rather than a genuinely
 * internal-only lane) because the scheduler already holds the schedule
 * owner's platform bearer token for this workspace, same as the /chat call
 * that started the turn.
 */
const endRouteDef = createRoute({
  method: 'post',
  path: '/{id}/reflect/end',
  tags: ['workspaces'],
  summary: "Advance (or leave) a store's Reflect checkpoint after a turn ends",
  security: [{ bearerAuth: [] }],
  request: {
    params: WorkspaceIdParam,
    body: { content: { 'application/json': { schema: ReflectEndBodySchema } } },
  },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: SuccessSchema } } },
    404: {
      description: 'Workspace, session, or store not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

reflect.openapi(endRouteDef, async (c) => {
  const currentUser = c.get('user')
  const { id } = c.req.valid('param')
  const { store_id, session_id, success } = c.req.valid('json')

  const workspace = await getWorkspace(id)
  if (!workspace || workspace.user_id !== currentUser.sub) {
    return c.json({ error: 'Workspace not found' }, 404)
  }

  // Clear the turn-scoped marker regardless of outcome. Conditional on still
  // matching store_id: a defensive no-op if something else already moved it.
  await clearActiveReflectStoreIfMatches(id, store_id)

  if (success) {
    const [session, store] = await Promise.all([getSession(session_id), getStoreById(store_id)])
    if (!session || !store) {
      return c.json({ error: 'Session or store not found' }, 404)
    }
    // Recompute the same window the turn's list_recent_activity call used
    // (see reflectWindow) rather than trusting a client-supplied bound —
    // both derive it from the same two persisted facts, so they agree
    // without the caller needing to pass anything beyond the session id.
    const { until } = reflectWindow(store, session.created_at)
    await setStoreLastReflectedAt(store_id, until)
  }

  return c.json({ success: true }, 200)
})

export default reflect
