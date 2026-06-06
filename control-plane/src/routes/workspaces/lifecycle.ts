import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { AppEnv } from '../../lib/types'
import { resetAllSessionsIdle } from '../../services/db/sessions'
import { getWorkspace, updateWorkspace } from '../../services/db/workspaces'
import * as k8s from '../../services/k8s'
import { startWorkspaceInstance } from '../../services/workspace-reconcile'
import { canManage, interruptAllSessions } from './_shared'

const lifecycle = new OpenAPIHono<AppEnv>()

const ErrorSchema = z.object({ error: z.string() })

const StartResponseSchema = z.object({
  success: z.boolean(),
  rebuilt: z.boolean().optional(),
})

const SuccessSchema = z.object({ success: z.boolean() })

const WorkspaceIdParam = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' } }),
})

// ── POST /:id/start ────────────────────────────────────────────────────────
const startRoute = createRoute({
  method: 'post',
  path: '/{id}/start',
  tags: ['workspaces'],
  summary: 'Start (or rebuild) a workspace instance',
  description:
    'If the configured agent_type differs from the running container image, the deployment is rebuilt before starting.',
  security: [{ bearerAuth: [] }],
  request: { params: WorkspaceIdParam },
  responses: {
    200: {
      description: 'Start initiated',
      content: { 'application/json': { schema: StartResponseSchema } },
    },
    404: {
      description: 'Workspace not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    500: {
      description: 'Internal error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

lifecycle.openapi(startRoute, async (c) => {
  const currentUser = c.get('user')
  const { id } = c.req.valid('param')
  const workspace = await getWorkspace(id)
  if (!workspace || !canManage(workspace, currentUser)) {
    return c.json({ error: 'Workspace not found' }, 404)
  }

  try {
    const { rebuilt } = await startWorkspaceInstance(workspace.id)
    return c.json({ success: true, rebuilt }, 200)
  } catch (e: any) {
    console.error('[start] Failed to start workspace:', e)
    const msg = e?.body?.message || e?.message || 'Unknown error'
    return c.json({ error: msg }, 500)
  }
})

// ── POST /:id/stop ─────────────────────────────────────────────────────────
const stopRoute = createRoute({
  method: 'post',
  path: '/{id}/stop',
  tags: ['workspaces'],
  summary: 'Stop a workspace instance',
  description:
    'Interrupts all active sessions, stops the K8s deployment, and resets session chat status.',
  security: [{ bearerAuth: [] }],
  request: { params: WorkspaceIdParam },
  responses: {
    200: {
      description: 'Stop initiated',
      content: { 'application/json': { schema: SuccessSchema } },
    },
    404: {
      description: 'Workspace not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    500: {
      description: 'Internal error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

lifecycle.openapi(stopRoute, async (c) => {
  const currentUser = c.get('user')
  const { id } = c.req.valid('param')
  const workspace = await getWorkspace(id)
  if (!workspace || !canManage(workspace, currentUser)) {
    return c.json({ error: 'Workspace not found' }, 404)
  }

  try {
    console.log(`[Stop] Request workspace=${id}`)
    await interruptAllSessions(workspace, 'Stop')
    await k8s.stopInstance(workspace.id)
    await resetAllSessionsIdle(id)
    await updateWorkspace(id, { status: 'stopped' })
    return c.json({ success: true }, 200)
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

export default lifecycle
