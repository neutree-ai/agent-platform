import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  AcceptTransferRequestSchema,
  ApiTransferPlanSchema,
  ApiWorkspaceTransferSchema,
} from '../../../internal/types/api'
import type { AppEnv } from '../lib/types'
import { getUser } from '../services/db/users'
import {
  getTransfer,
  listPendingTransfersTo,
  transitionTransfer,
} from '../services/db/workspace-transfers'
import { getWorkspace } from '../services/db/workspaces'
import { notify } from '../services/notifications'
import { UsageNotDrained } from '../services/usage/teardown'
import { TransferRejected, executeTransfer } from '../services/workspace-transfer'
import { planTransfer } from '../services/workspace-transfer-plan'

// The recipient's side of a workspace transfer: see what is offered, then
// accept or decline. The sender's side is in routes/workspaces/transfer.ts.

const transfers = new OpenAPIHono<AppEnv>()

const ErrorSchema = z.object({ error: z.string() })
const SuccessSchema = z.object({ success: z.boolean() })

const TransferIdParam = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' } }),
})

const errors = {
  400: { description: 'Invalid request', content: { 'application/json': { schema: ErrorSchema } } },
  404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
  409: { description: 'Conflict', content: { 'application/json': { schema: ErrorSchema } } },
}

// ── GET / ──────────────────────────────────────────────────────────────────
const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['transfers'],
  summary: 'Workspace transfers waiting on the caller',
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Pending transfers to the caller',
      content: { 'application/json': { schema: z.array(ApiWorkspaceTransferSchema) } },
    },
  },
})

transfers.openapi(listRoute, async (c) => {
  return c.json(await listPendingTransfersTo(c.get('user').sub), 200)
})

// ── GET /:id ───────────────────────────────────────────────────────────────
const getRouteDef = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['transfers'],
  summary: 'A transfer, with its plan while it is pending',
  description:
    'Visible to its sender and recipient. The plan is recomputed from live ' +
    'state, so it shows what accepting would do now.',
  security: [{ bearerAuth: [] }],
  request: { params: TransferIdParam },
  responses: {
    200: {
      description: 'Transfer',
      content: {
        'application/json': {
          schema: z.object({
            transfer: ApiWorkspaceTransferSchema,
            plan: ApiTransferPlanSchema.nullable(),
          }),
        },
      },
    },
    404: errors[404],
  },
})

transfers.openapi(getRouteDef, async (c) => {
  const user = c.get('user')
  const transfer = await getTransfer(c.req.valid('param').id)
  if (!transfer || (transfer.to_user.id !== user.sub && transfer.from_user.id !== user.sub)) {
    return c.json({ error: 'Transfer not found' }, 404)
  }
  let plan = null
  if (transfer.status === 'pending') {
    const [workspace, from, to] = await Promise.all([
      getWorkspace(transfer.workspace_id),
      getUser(transfer.from_user.id),
      getUser(transfer.to_user.id),
    ])
    if (workspace && from && to && workspace.user_id === from.id) {
      plan = (await planTransfer(workspace, from, to, transfer.copy)).plan
    }
  }
  return c.json({ transfer, plan }, 200)
})

// ── POST /:id/accept ───────────────────────────────────────────────────────
const acceptRoute = createRoute({
  method: 'post',
  path: '/{id}/accept',
  tags: ['transfers'],
  summary: 'Accept a transfer; the workspace becomes the caller’s',
  description:
    'Runs the transfer. `slug` is required when the caller already has a ' +
    'workspace with the same slug; `provider_id` when the caller cannot use ' +
    'the workspace’s provider. A failed attempt leaves the transfer pending.',
  security: [{ bearerAuth: [] }],
  request: {
    params: TransferIdParam,
    body: { content: { 'application/json': { schema: AcceptTransferRequestSchema } } },
  },
  responses: {
    200: {
      description: 'Transferred',
      content: { 'application/json': { schema: ApiWorkspaceTransferSchema } },
    },
    ...errors,
  },
})

transfers.openapi(acceptRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const body = c.req.valid('json')
  const transfer = await getTransfer(id)
  if (!transfer || transfer.to_user.id !== user.sub) {
    return c.json({ error: 'Transfer not found' }, 404)
  }
  if (!(await transitionTransfer(id, 'pending', 'executing'))) {
    return c.json({ error: `Transfer is ${transfer.status}` }, 409)
  }

  try {
    await executeTransfer({
      transferId: id,
      workspaceId: transfer.workspace_id,
      fromUserId: transfer.from_user.id,
      toUserId: transfer.to_user.id,
      inputs: { slug: body.slug, providerId: body.provider_id, copy: transfer.copy },
      onFailure: 'pending',
      allowNoProvider: false,
    })
  } catch (e) {
    if (e instanceof TransferRejected) return c.json({ error: e.message }, e.status)
    if (e instanceof UsageNotDrained) return c.json({ error: e.message }, 409)
    throw e
  }
  return c.json((await getTransfer(id))!, 200)
})

// ── POST /:id/decline ──────────────────────────────────────────────────────
const declineRoute = createRoute({
  method: 'post',
  path: '/{id}/decline',
  tags: ['transfers'],
  summary: 'Decline a transfer',
  security: [{ bearerAuth: [] }],
  request: { params: TransferIdParam },
  responses: {
    200: { description: 'Declined', content: { 'application/json': { schema: SuccessSchema } } },
    404: errors[404],
    409: errors[409],
  },
})

transfers.openapi(declineRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const transfer = await getTransfer(id)
  if (!transfer || transfer.to_user.id !== user.sub) {
    return c.json({ error: 'Transfer not found' }, 404)
  }
  if (!(await transitionTransfer(id, 'pending', 'declined'))) {
    return c.json({ error: `Transfer is ${transfer.status}` }, 409)
  }
  await notify({
    eventType: 'workspace.transfer_declined',
    payload: {
      title: `Transfer declined: ${transfer.workspace_name}`,
      body: `**${transfer.to_user.display_name}** declined the workspace **${transfer.workspace_name}**. It stays yours.`,
      type: 'info',
      metadata: { transfer_id: id, workspace_id: transfer.workspace_id },
    },
    actorId: user.sub,
    targetUserIds: [transfer.from_user.id],
  }).catch((e) => console.warn('[transfer] notify sender failed:', e?.message ?? e))
  return c.json({ success: true }, 200)
})

export default transfers
