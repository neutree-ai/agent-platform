import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  ApiTransferPlanSchema,
  ApiWorkspaceTransferSchema,
  CreateTransferRequestSchema,
} from '../../../../internal/types/api'
import type { AppEnv } from '../../lib/types'
import { getUser, getUserByUsername } from '../../services/db/users'
import {
  createTransfer,
  getOpenTransferForWorkspace,
  getTransfer,
  transitionTransfer,
} from '../../services/db/workspace-transfers'
import { getWorkspace } from '../../services/db/workspaces'
import { notify } from '../../services/notifications'
import { TransferRejected, assertTransferable } from '../../services/workspace-transfer'
import { planTransfer } from '../../services/workspace-transfer-plan'
import { canManage } from './_shared'

// The sender's side of a workspace transfer: preview the plan for a recipient,
// start the transfer, and cancel it while it is pending. The recipient's side
// (accept / decline) is in routes/transfers.ts.

const transfer = new OpenAPIHono<AppEnv>()

const ErrorSchema = z.object({ error: z.string() })
const SuccessSchema = z.object({ success: z.boolean() })

const WorkspaceIdParam = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' } }),
})

const errors = {
  400: { description: 'Invalid request', content: { 'application/json': { schema: ErrorSchema } } },
  404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
  409: { description: 'Conflict', content: { 'application/json': { schema: ErrorSchema } } },
}

async function loadOwned(id: string, user: { sub: string; role: string }) {
  const workspace = await getWorkspace(id)
  // canManage also admits admins on system workspaces, which cannot be
  // transferred anyway; the owner check here is the one that matters.
  if (!workspace || !canManage(workspace, user) || workspace.user_id !== user.sub) return null
  return workspace
}

// ── GET /:id/transfer ──────────────────────────────────────────────────────
const getRoute = createRoute({
  method: 'get',
  path: '/{id}/transfer',
  tags: ['workspaces'],
  summary: "The workspace's pending transfer, if any",
  security: [{ bearerAuth: [] }],
  request: { params: WorkspaceIdParam },
  responses: {
    200: {
      description: 'Pending transfer, or null',
      content: { 'application/json': { schema: ApiWorkspaceTransferSchema.nullable() } },
    },
    404: errors[404],
  },
})

transfer.openapi(getRoute, async (c) => {
  const workspace = await loadOwned(c.req.valid('param').id, c.get('user'))
  if (!workspace) return c.json({ error: 'Workspace not found' }, 404)
  return c.json(await getOpenTransferForWorkspace(workspace.id), 200)
})

// ── GET /:id/transfer/plan ─────────────────────────────────────────────────
const planRoute = createRoute({
  method: 'get',
  path: '/{id}/transfer/plan',
  tags: ['workspaces'],
  summary: 'Preview what transferring the workspace to a user would do',
  description:
    'The recipient is named by exact username; there is no search, so this ' +
    'cannot be used to enumerate users beyond confirming a known name.',
  security: [{ bearerAuth: [] }],
  request: {
    params: WorkspaceIdParam,
    query: z.object({
      to: z
        .string()
        .min(1)
        .openapi({ param: { name: 'to', in: 'query' } }),
    }),
  },
  responses: {
    200: {
      description: 'Plan',
      content: { 'application/json': { schema: ApiTransferPlanSchema } },
    },
    ...errors,
  },
})

transfer.openapi(planRoute, async (c) => {
  const user = c.get('user')
  const workspace = await loadOwned(c.req.valid('param').id, user)
  if (!workspace) return c.json({ error: 'Workspace not found' }, 404)
  const [from, to] = await Promise.all([
    getUser(user.sub),
    getUserByUsername(c.req.valid('query').to),
  ])
  if (!from) return c.json({ error: 'Workspace not found' }, 404)
  if (!to) return c.json({ error: 'User not found' }, 404)
  try {
    assertTransferable(workspace, to)
  } catch (e) {
    if (e instanceof TransferRejected) return c.json({ error: e.message }, e.status)
    throw e
  }
  const { plan } = await planTransfer(workspace, from, to)
  return c.json(plan, 200)
})

// ── POST /:id/transfer ─────────────────────────────────────────────────────
const createRouteDef = createRoute({
  method: 'post',
  path: '/{id}/transfer',
  tags: ['workspaces'],
  summary: 'Offer the workspace to another user',
  description:
    'Opens a pending transfer; the recipient accepts or declines it. The ' +
    'workspace keeps running and stays the sender’s until then.',
  security: [{ bearerAuth: [] }],
  request: {
    params: WorkspaceIdParam,
    body: { content: { 'application/json': { schema: CreateTransferRequestSchema } } },
  },
  responses: {
    201: {
      description: 'Transfer opened',
      content: { 'application/json': { schema: ApiWorkspaceTransferSchema } },
    },
    ...errors,
  },
})

transfer.openapi(createRouteDef, async (c) => {
  const user = c.get('user')
  const workspace = await loadOwned(c.req.valid('param').id, user)
  if (!workspace) return c.json({ error: 'Workspace not found' }, 404)
  const body = c.req.valid('json')
  const [from, to] = await Promise.all([getUser(user.sub), getUserByUsername(body.to_username)])
  if (!from) return c.json({ error: 'Workspace not found' }, 404)
  if (!to) return c.json({ error: 'User not found' }, 404)

  try {
    assertTransferable(workspace, to)
  } catch (e) {
    if (e instanceof TransferRejected) return c.json({ error: e.message }, e.status)
    throw e
  }
  // Refuse up front what the recipient could never accept.
  const { plan } = await planTransfer(workspace, from, to, body.copy)
  if (plan.blocked) {
    return c.json(
      { error: 'The workspace runs on a private environment the recipient cannot use' },
      409,
    )
  }

  let id: string
  try {
    id = await createTransfer({
      workspaceId: workspace.id,
      fromUserId: from.id,
      toUserId: to.id,
      initiatedBy: from.id,
      copy: body.copy,
      status: 'pending',
    })
  } catch (e: any) {
    if (e?.code === '23505') {
      return c.json({ error: 'The workspace already has a pending transfer' }, 409)
    }
    throw e
  }

  const webBase = (process.env.WEB_PUBLIC_URL || '').replace(/\/$/, '')
  await notify({
    eventType: 'workspace.transfer_offered',
    payload: {
      title: `Workspace offered to you: ${workspace.name}`,
      body: `**${from.display_name}** wants to transfer the workspace **${workspace.name}** to you. Review and accept or decline.`,
      type: 'info',
      url: webBase ? `${webBase}/transfers/${id}` : undefined,
      metadata: { transfer_id: id, workspace_id: workspace.id },
    },
    actorId: from.id,
    targetUserIds: [to.id],
  }).catch((e) => console.warn('[transfer] notify recipient failed:', e?.message ?? e))

  return c.json((await getTransfer(id))!, 201)
})

// ── DELETE /:id/transfer ───────────────────────────────────────────────────
const cancelRoute = createRoute({
  method: 'delete',
  path: '/{id}/transfer',
  tags: ['workspaces'],
  summary: 'Cancel the workspace’s pending transfer',
  security: [{ bearerAuth: [] }],
  request: { params: WorkspaceIdParam },
  responses: {
    200: { description: 'Cancelled', content: { 'application/json': { schema: SuccessSchema } } },
    404: errors[404],
  },
})

transfer.openapi(cancelRoute, async (c) => {
  const workspace = await loadOwned(c.req.valid('param').id, c.get('user'))
  if (!workspace) return c.json({ error: 'Workspace not found' }, 404)
  const open = await getOpenTransferForWorkspace(workspace.id)
  if (!open || !(await transitionTransfer(open.id, 'pending', 'cancelled'))) {
    return c.json({ error: 'No pending transfer' }, 404)
  }
  return c.json({ success: true }, 200)
})

export default transfer
