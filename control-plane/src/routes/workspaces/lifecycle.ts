import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { AppEnv } from '../../lib/types'
import { resetAllSessionsIdle } from '../../services/db/sessions'
import { getWorkspace, updateWorkspace } from '../../services/db/workspaces'
import { bumpWorkspaceSpec, setDesiredPhase } from '../../services/placement'
import { reconcileWorkspacePod, startWorkspaceInstance } from '../../services/workspace-reconcile'
import { canManage, interruptAllSessions } from './_shared'

const lifecycle = new OpenAPIHono<AppEnv>()

const ErrorSchema = z.object({ error: z.string() })

const StartResponseSchema = z.object({
  success: z.boolean(),
  rebuilt: z.boolean().optional(),
})

const SuccessSchema = z.object({ success: z.boolean() })

const RebuildResponseSchema = z.object({
  // false when the workspace was already in sync (no-op).
  rebuilt: z.boolean(),
  // Diagnostic drift summary when rebuilt; omitted otherwise. Not shown to users.
  reason: z.string().optional(),
})

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
    // Control inversion (P1): record desired=stopped; the env-runner scales down.
    await setDesiredPhase(workspace.id, 'stopped')
    await resetAllSessionsIdle(id)
    await updateWorkspace(id, { status: 'stopped' })
    return c.json({ success: true }, 200)
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ── POST /:id/restart ──────────────────────────────────────────────────────
const restartRoute = createRoute({
  method: 'post',
  path: '/{id}/restart',
  tags: ['workspaces'],
  summary: 'Restart a workspace — replace its pod, preserving state',
  description:
    "Recreates the workspace's pod (clearing in-pod ephemeral/agent state such " +
    'as a stuck agent process) while keeping desired_phase=running, the PVC, ' +
    'and persisted session history. Replaces the racy client-side stop+start: ' +
    'bumps the placement spec so the env-runner rebuilds the Deployment in one ' +
    'converge, so the pod is always actually replaced (a fast stop+start could ' +
    'leave the old pod running because the stopped window was never observed).',
  security: [{ bearerAuth: [] }],
  request: { params: WorkspaceIdParam },
  responses: {
    200: {
      description: 'Restart initiated',
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

lifecycle.openapi(restartRoute, async (c) => {
  const currentUser = c.get('user')
  const { id } = c.req.valid('param')
  const workspace = await getWorkspace(id)
  if (!workspace || !canManage(workspace, currentUser)) {
    return c.json({ error: 'Workspace not found' }, 404)
  }

  try {
    console.log(`[Restart] Request workspace=${id}`)
    await interruptAllSessions(workspace, 'Restart')
    // Force a pod replacement via the placement system rather than a client-side
    // stop→start: bumping spec_version makes the env-runner re-apply (rebuild the
    // Deployment → new pod) on its next converge. desired_phase stays 'running'
    // throughout, so — unlike stop+start — there is no stopped window to race
    // away, and the pod is reliably recreated. PVC + session history persist.
    await bumpWorkspaceSpec(id)
    await setDesiredPhase(id, 'running')
    await resetAllSessionsIdle(id)
    await updateWorkspace(id, { status: 'starting' })
    return c.json({ success: true }, 200)
  } catch (e: any) {
    console.error('[Restart] Failed:', e)
    return c.json({ error: e.message }, 500)
  }
})

// ── POST /:id/rebuild ──────────────────────────────────────────────────────
const rebuildRoute = createRoute({
  method: 'post',
  path: '/{id}/rebuild',
  tags: ['workspaces'],
  summary: 'Rebuild a workspace to the current platform template',
  description:
    "Recreates the workspace's Deployment when it drifts from the current " +
    'desired spec (template version, agent image, sidecars), picking up ' +
    'platform updates. DISRUPTIVE: the pod is replaced, interrupting any ' +
    'in-flight session and clearing ephemeral (tmpfs) state. No-op when ' +
    'already in sync.',
  security: [{ bearerAuth: [] }],
  request: { params: WorkspaceIdParam },
  responses: {
    200: {
      description: 'Rebuild evaluated (rebuilt=false when already in sync)',
      content: { 'application/json': { schema: RebuildResponseSchema } },
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

lifecycle.openapi(rebuildRoute, async (c) => {
  const currentUser = c.get('user')
  const { id } = c.req.valid('param')
  const workspace = await getWorkspace(id)
  if (!workspace || !canManage(workspace, currentUser)) {
    return c.json({ error: 'Workspace not found' }, 404)
  }

  try {
    const { rebuilt, reason } = await reconcileWorkspacePod(workspace.id)
    if (rebuilt) {
      console.log(`[Rebuild] workspace=${id} rebuilt: ${reason}`)
      // The old pod is gone — clear stale chat status and reflect that the
      // instance is coming back up so the UI shows it re-launching.
      await resetAllSessionsIdle(id)
      await updateWorkspace(id, { status: 'starting' })
    }
    return c.json({ rebuilt, reason }, 200)
  } catch (e: any) {
    console.error('[Rebuild] Failed:', e)
    const msg = e?.body?.message || e?.message || 'Unknown error'
    return c.json({ error: msg }, 500)
  }
})

export default lifecycle
