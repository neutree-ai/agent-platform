import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  ApiMemoryLiteSchema,
  ApiMemoryStoreAttachmentSchema,
  ApiMemoryStoreSchema,
  ApiMemoryVersionDetailSchema,
  ApiMemoryVersionSchema,
  ApiWorkspaceMemoryAttachmentSchema,
  MemoryDeleteBodySchema,
  MemoryPutBodySchema,
  MemoryRollbackBodySchema,
  MemoryStoreCreateBodySchema,
  MemoryStorePatchBodySchema,
  WORKSPACE_MEMORY_ATTACHMENT_MAX,
  WorkspaceMemoryAttachBodySchema,
  WorkspaceMemoryAttachmentPatchBodySchema,
} from '../../../internal/types/api'
import type { AppEnv } from '../lib/types'
import { notifyAgentReload } from '../lib/workspace-address'
import {
  PathConflictError,
  PreconditionFailedError,
  attachStore,
  countAttachmentsForWorkspace,
  createStore,
  deleteMemoryByPath,
  deleteStore,
  detachStore,
  getAttachment,
  getMemoryByPath,
  getStoreById,
  getVersionById,
  listAttachmentsForStore,
  listAttachmentsForWorkspace,
  listMemories,
  listStoresForUser,
  listVersions,
  patchAttachment,
  patchStore,
  putMemory,
  rollbackToVersion,
} from '../services/db/memory'
import { getWorkspace } from '../services/db/workspaces'
import { isMemoryFuseAvailable } from '../services/k8s'
import * as memoryFuse from '../services/memory-fuse'
import { broadcastStoreInvalidate } from '../services/memory-fuse'

const ErrorSchema = z.object({ error: z.string() })
const SuccessSchema = z.object({ success: z.boolean() })

// ── /api/memory-stores ──────────────────────────────────────────────────────

const stores = new OpenAPIHono<AppEnv>()

const StoreIdParam = z.object({
  storeId: z.string().openapi({ param: { name: 'storeId', in: 'path' } }),
})

async function assertStoreOwner(
  storeId: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; status: 403 | 404; error: string }> {
  const s = await getStoreById(storeId)
  if (!s) return { ok: false, status: 404, error: 'memory store not found' }
  if (s.owner_user_id !== userId) return { ok: false, status: 403, error: 'forbidden' }
  return { ok: true }
}

// list stores ───────────────────────────────────────────────────────────────

stores.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['memory-stores'],
    summary: 'List memory stores owned by the current user',
    security: [{ bearerAuth: [] }],
    request: {
      query: z.object({
        include_archived: z.coerce.boolean().optional(),
      }),
    },
    responses: {
      200: {
        description: 'OK',
        content: {
          'application/json': { schema: z.object({ stores: z.array(ApiMemoryStoreSchema) }) },
        },
      },
    },
  }),
  async (c) => {
    const user = c.get('user')
    const { include_archived } = c.req.valid('query')
    const rows = await listStoresForUser(user.sub, !!include_archived)
    return c.json({ stores: rows }, 200)
  },
)

// create store ──────────────────────────────────────────────────────────────

stores.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['memory-stores'],
    summary: 'Create a memory store',
    security: [{ bearerAuth: [] }],
    request: { body: { content: { 'application/json': { schema: MemoryStoreCreateBodySchema } } } },
    responses: {
      201: {
        description: 'Created',
        content: { 'application/json': { schema: ApiMemoryStoreSchema } },
      },
    },
  }),
  async (c) => {
    const user = c.get('user')
    const body = c.req.valid('json')
    const store = await createStore({
      ownerUserId: user.sub,
      name: body.name,
      description: body.description,
    })
    return c.json(store, 201)
  },
)

// get store ─────────────────────────────────────────────────────────────────

stores.openapi(
  createRoute({
    method: 'get',
    path: '/{storeId}',
    tags: ['memory-stores'],
    security: [{ bearerAuth: [] }],
    request: { params: StoreIdParam },
    responses: {
      200: { description: 'OK', content: { 'application/json': { schema: ApiMemoryStoreSchema } } },
      403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const user = c.get('user')
    const { storeId } = c.req.valid('param')
    const access = await assertStoreOwner(storeId, user.sub)
    if (!access.ok) {
      if (access.status === 403) return c.json({ error: access.error }, 403)
      return c.json({ error: access.error }, 404)
    }
    const s = await getStoreById(storeId)
    return c.json(s!, 200)
  },
)

// patch store ───────────────────────────────────────────────────────────────

stores.openapi(
  createRoute({
    method: 'patch',
    path: '/{storeId}',
    tags: ['memory-stores'],
    security: [{ bearerAuth: [] }],
    request: {
      params: StoreIdParam,
      body: { content: { 'application/json': { schema: MemoryStorePatchBodySchema } } },
    },
    responses: {
      200: { description: 'OK', content: { 'application/json': { schema: ApiMemoryStoreSchema } } },
      403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const user = c.get('user')
    const { storeId } = c.req.valid('param')
    const body = c.req.valid('json')
    const access = await assertStoreOwner(storeId, user.sub)
    if (!access.ok) {
      if (access.status === 403) return c.json({ error: access.error }, 403)
      return c.json({ error: access.error }, 404)
    }
    const s = await patchStore(storeId, {
      name: body.name,
      description: body.description,
      archived: body.archived,
    })
    return c.json(s!, 200)
  },
)

// delete store ──────────────────────────────────────────────────────────────

stores.openapi(
  createRoute({
    method: 'delete',
    path: '/{storeId}',
    tags: ['memory-stores'],
    security: [{ bearerAuth: [] }],
    request: { params: StoreIdParam },
    responses: {
      200: { description: 'OK', content: { 'application/json': { schema: SuccessSchema } } },
      403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
      409: {
        description: 'Conflict — store still attached to one or more workspaces',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const user = c.get('user')
    const { storeId } = c.req.valid('param')
    const access = await assertStoreOwner(storeId, user.sub)
    if (!access.ok) {
      if (access.status === 403) return c.json({ error: access.error }, 403)
      return c.json({ error: access.error }, 404)
    }
    // Reject if the store is still attached to any workspace. Memory data is
    // typically valuable user state; if we cascaded the delete here, FUSE
    // mounts in those workspaces would keep their mountpoints but every
    // read would hit EIO until rebuild, and the user wouldn't see the chain
    // of consequences. Force the owner to detach each workspace first.
    const attached = await listAttachmentsForStore(storeId)
    if (attached.length > 0) {
      return c.json(
        {
          error: `Store is still attached to ${attached.length} workspace(s). Detach first, then delete.`,
        },
        409,
      )
    }
    await deleteStore(storeId)
    return c.json({ success: true }, 200)
  },
)

// list workspaces this store is attached to ────────────────────────────────

stores.openapi(
  createRoute({
    method: 'get',
    path: '/{storeId}/attachments',
    tags: ['memory-stores'],
    security: [{ bearerAuth: [] }],
    request: { params: StoreIdParam },
    responses: {
      200: {
        description: 'OK',
        content: {
          'application/json': {
            schema: z.object({ attachments: z.array(ApiMemoryStoreAttachmentSchema) }),
          },
        },
      },
      403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const user = c.get('user')
    const { storeId } = c.req.valid('param')
    const access = await assertStoreOwner(storeId, user.sub)
    if (!access.ok) {
      if (access.status === 403) return c.json({ error: access.error }, 403)
      return c.json({ error: access.error }, 404)
    }
    const rows = await listAttachmentsForStore(storeId)
    return c.json({ attachments: rows }, 200)
  },
)

// list memories in store ────────────────────────────────────────────────────

stores.openapi(
  createRoute({
    method: 'get',
    path: '/{storeId}/memories',
    tags: ['memory-stores'],
    security: [{ bearerAuth: [] }],
    request: { params: StoreIdParam },
    responses: {
      200: {
        description: 'OK',
        content: {
          'application/json': { schema: z.object({ memories: z.array(ApiMemoryLiteSchema) }) },
        },
      },
      403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const user = c.get('user')
    const { storeId } = c.req.valid('param')
    const access = await assertStoreOwner(storeId, user.sub)
    if (!access.ok) {
      if (access.status === 403) return c.json({ error: access.error }, 403)
      return c.json({ error: access.error }, 404)
    }
    const rows = await listMemories(storeId)
    return c.json({ memories: rows }, 200)
  },
)

// get / put / delete memory at path. We use a non-OpenAPI Hono route here
// because OpenAPI-Hono path params don't accept arbitrary slashes; this
// captures the rest of the URL as the memory path (with leading slash).

stores.get('/:storeId/memory/*', async (c) => {
  const user = c.get('user')
  const storeId = c.req.param('storeId')
  const access = await assertStoreOwner(storeId, user.sub)
  if (!access.ok) return c.json({ error: access.error }, access.status)
  const path = extractMemoryPath(c.req.path, storeId)
  const m = await getMemoryByPath(storeId, path)
  if (!m) return c.json({ error: 'memory not found' }, 404)
  return c.json(m)
})

stores.put('/:storeId/memory/*', async (c) => {
  const user = c.get('user')
  const storeId = c.req.param('storeId')
  const access = await assertStoreOwner(storeId, user.sub)
  if (!access.ok) return c.json({ error: access.error }, access.status)
  const path = extractMemoryPath(c.req.path, storeId)
  const parsed = MemoryPutBodySchema.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: 'invalid body' }, 400)
  try {
    const m = await putMemory({
      storeId,
      path,
      content: parsed.data.content,
      description: parsed.data.description,
      memType: parsed.data.mem_type,
      ifMatchSha256: parsed.data.if_match_sha256,
      actorKind: 'user',
      actorId: user.sub,
    })
    broadcastStoreInvalidate(storeId)
    return c.json(m)
  } catch (e) {
    if (e instanceof PathConflictError)
      return c.json({ error: 'memory already exists at path' }, 409)
    if (e instanceof PreconditionFailedError) {
      return c.json({ error: 'sha256 precondition failed', current_sha256: e.currentSha }, 412)
    }
    throw e
  }
})

stores.delete('/:storeId/memory/*', async (c) => {
  const user = c.get('user')
  const storeId = c.req.param('storeId')
  const access = await assertStoreOwner(storeId, user.sub)
  if (!access.ok) return c.json({ error: access.error }, access.status)
  const path = extractMemoryPath(c.req.path, storeId)
  let body: { if_match_sha256?: string } = {}
  try {
    body = MemoryDeleteBodySchema.parse(await c.req.json().catch(() => ({})))
  } catch {
    return c.json({ error: 'invalid body' }, 400)
  }
  try {
    const ok = await deleteMemoryByPath({
      storeId,
      path,
      ifMatchSha256: body.if_match_sha256,
      actorKind: 'user',
      actorId: user.sub,
    })
    if (!ok) return c.json({ error: 'memory not found' }, 404)
    broadcastStoreInvalidate(storeId)
    return c.json({ success: true })
  } catch (e) {
    if (e instanceof PreconditionFailedError) {
      return c.json({ error: 'sha256 precondition failed', current_sha256: e.currentSha }, 412)
    }
    throw e
  }
})

// list versions ─────────────────────────────────────────────────────────────

stores.openapi(
  createRoute({
    method: 'get',
    path: '/{storeId}/versions',
    tags: ['memory-stores'],
    security: [{ bearerAuth: [] }],
    request: {
      params: StoreIdParam,
      query: z.object({
        path: z.string().optional(),
        limit: z.coerce.number().int().positive().max(500).optional(),
      }),
    },
    responses: {
      200: {
        description: 'OK',
        content: {
          'application/json': { schema: z.object({ versions: z.array(ApiMemoryVersionSchema) }) },
        },
      },
      403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const user = c.get('user')
    const { storeId } = c.req.valid('param')
    const { path, limit } = c.req.valid('query')
    const access = await assertStoreOwner(storeId, user.sub)
    if (!access.ok) {
      if (access.status === 403) return c.json({ error: access.error }, 403)
      return c.json({ error: access.error }, 404)
    }
    const rows = await listVersions(storeId, { path, limit })
    return c.json({ versions: rows }, 200)
  },
)

// get version detail (with content) ────────────────────────────────────────

stores.openapi(
  createRoute({
    method: 'get',
    path: '/{storeId}/memory-versions/{versionId}',
    tags: ['memory-stores'],
    security: [{ bearerAuth: [] }],
    request: {
      params: StoreIdParam.extend({
        versionId: z.string().openapi({ param: { name: 'versionId', in: 'path' } }),
      }),
    },
    responses: {
      200: {
        description: 'OK',
        content: { 'application/json': { schema: ApiMemoryVersionDetailSchema } },
      },
      403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const user = c.get('user')
    const { storeId, versionId } = c.req.valid('param')
    const access = await assertStoreOwner(storeId, user.sub)
    if (!access.ok) {
      if (access.status === 403) return c.json({ error: access.error }, 403)
      return c.json({ error: access.error }, 404)
    }
    const v = await getVersionById(storeId, versionId)
    if (!v) return c.json({ error: 'version not found' }, 404)
    return c.json(v, 200)
  },
)

// rollback memory at path to a previous version ─────────────────────────────

stores.post('/:storeId/rollback', async (c) => {
  const user = c.get('user')
  const storeId = c.req.param('storeId')
  const access = await assertStoreOwner(storeId, user.sub)
  if (!access.ok) return c.json({ error: access.error }, access.status)
  const parsed = MemoryRollbackBodySchema.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) return c.json({ error: 'invalid body' }, 400)
  try {
    const m = await rollbackToVersion({
      storeId,
      versionId: parsed.data.version_id,
      actorKind: 'user',
      actorId: user.sub,
    })
    broadcastStoreInvalidate(storeId)
    return c.json(m)
  } catch (e) {
    if (e instanceof PreconditionFailedError) {
      return c.json({ error: 'sha256 precondition failed', current_sha256: e.currentSha }, 412)
    }
    if (e instanceof Error && e.message === 'version not found') {
      return c.json({ error: 'version not found' }, 404)
    }
    if (e instanceof Error && e.message === 'cannot rollback to a delete operation') {
      return c.json({ error: e.message }, 400)
    }
    throw e
  }
})

// extracts the memory path (with leading slash) from a request URL like
// /api/memory-stores/<id>/memory/foo/bar.md → /foo/bar.md
function extractMemoryPath(reqPath: string, storeId: string): string {
  const marker = `/memory-stores/${storeId}/memory`
  const idx = reqPath.indexOf(marker)
  if (idx < 0) return '/'
  const tail = reqPath.slice(idx + marker.length)
  return tail.startsWith('/') ? tail : `/${tail}`
}

// ── /api/workspaces/:workspaceId/memory-attachments ─────────────────────────

const attachments = new OpenAPIHono<AppEnv>()

const WorkspaceIdParam = z.object({
  workspaceId: z.string().openapi({ param: { name: 'workspaceId', in: 'path' } }),
})

const WsAttachmentParam = WorkspaceIdParam.extend({
  storeId: z.string().openapi({ param: { name: 'storeId', in: 'path' } }),
})

async function assertWorkspaceOwner(
  workspaceId: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; status: 403 | 404; error: string }> {
  const ws = await getWorkspace(workspaceId)
  if (!ws) return { ok: false, status: 404, error: 'workspace not found' }
  if (ws.user_id !== userId) return { ok: false, status: 403, error: 'forbidden' }
  return { ok: true }
}

attachments.openapi(
  createRoute({
    method: 'get',
    path: '/{workspaceId}/memory-attachments',
    tags: ['workspace-memory'],
    security: [{ bearerAuth: [] }],
    request: { params: WorkspaceIdParam },
    responses: {
      200: {
        description: 'OK',
        content: {
          'application/json': {
            schema: z.object({ attachments: z.array(ApiWorkspaceMemoryAttachmentSchema) }),
          },
        },
      },
      403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const user = c.get('user')
    const { workspaceId } = c.req.valid('param')
    const access = await assertWorkspaceOwner(workspaceId, user.sub)
    if (!access.ok) {
      if (access.status === 403) return c.json({ error: access.error }, 403)
      return c.json({ error: access.error }, 404)
    }
    const rows = await listAttachmentsForWorkspace(workspaceId)
    return c.json({ attachments: rows }, 200)
  },
)

attachments.openapi(
  createRoute({
    method: 'post',
    path: '/{workspaceId}/memory-attachments',
    tags: ['workspace-memory'],
    security: [{ bearerAuth: [] }],
    request: {
      params: WorkspaceIdParam,
      body: { content: { 'application/json': { schema: WorkspaceMemoryAttachBodySchema } } },
    },
    responses: {
      201: {
        description: 'Attached',
        content: { 'application/json': { schema: ApiWorkspaceMemoryAttachmentSchema } },
      },
      400: {
        description: 'Cluster unsupported',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
      409: { description: 'Cap reached', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const user = c.get('user')
    const { workspaceId } = c.req.valid('param')
    const body = c.req.valid('json')
    if (!isMemoryFuseAvailable()) {
      return c.json({ error: 'memory-fuse is not configured on this cluster' }, 400)
    }
    const wsAccess = await assertWorkspaceOwner(workspaceId, user.sub)
    if (!wsAccess.ok) {
      if (wsAccess.status === 403) return c.json({ error: wsAccess.error }, 403)
      return c.json({ error: wsAccess.error }, 404)
    }
    const storeAccess = await assertStoreOwner(body.store_id, user.sub)
    if (!storeAccess.ok) {
      if (storeAccess.status === 403) return c.json({ error: storeAccess.error }, 403)
      return c.json({ error: storeAccess.error }, 404)
    }
    const existing = await getAttachment(workspaceId, body.store_id)
    if (!existing) {
      const n = await countAttachmentsForWorkspace(workspaceId)
      if (n >= WORKSPACE_MEMORY_ATTACHMENT_MAX) {
        return c.json({ error: `attachment cap reached (${WORKSPACE_MEMORY_ATTACHMENT_MAX})` }, 409)
      }
    }
    const row = await attachStore({
      workspaceId,
      storeId: body.store_id,
      access: body.access,
      instructions: body.instructions,
    })
    // Live propagation: every ws always carries the memory-fuse sidecar
    // since template v4, so attach is purely a Mount RPC + prompt refresh.
    // No reconcile / rebuild path — that was for the 0↔1 sidecar gate that
    // no longer exists.
    const ws = await getWorkspace(workspaceId)
    if (ws?.status === 'running' && row) {
      await memoryFuse
        .mountStore(workspaceId, { storeId: row.store_id, access: row.access })
        .catch((e) => console.error(`[attach ${workspaceId}] Mount RPC failed:`, e))
      notifyAgentReload(workspaceId, ['config']).catch(() => {})
    }
    return c.json(row!, 201)
  },
)

attachments.openapi(
  createRoute({
    method: 'patch',
    path: '/{workspaceId}/memory-attachments/{storeId}',
    tags: ['workspace-memory'],
    security: [{ bearerAuth: [] }],
    request: {
      params: WsAttachmentParam,
      body: {
        content: { 'application/json': { schema: WorkspaceMemoryAttachmentPatchBodySchema } },
      },
    },
    responses: {
      200: {
        description: 'OK',
        content: { 'application/json': { schema: ApiWorkspaceMemoryAttachmentSchema } },
      },
      403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const user = c.get('user')
    const { workspaceId, storeId } = c.req.valid('param')
    const body = c.req.valid('json')
    const wsAccess = await assertWorkspaceOwner(workspaceId, user.sub)
    if (!wsAccess.ok) {
      if (wsAccess.status === 403) return c.json({ error: wsAccess.error }, 403)
      return c.json({ error: wsAccess.error }, 404)
    }
    const row = await patchAttachment(workspaceId, storeId, body)
    if (!row) return c.json({ error: 'attachment not found' }, 404)
    // access change (ro↔rw) needs to reach the running sidecar; Mount is
    // idempotent and overwrites. instructions are stored cp-side and surface
    // via platform prompt — daemon doesn't consume them, no RPC needed.
    const ws = await getWorkspace(workspaceId)
    if (ws?.status === 'running') {
      if (body.access !== undefined) {
        await memoryFuse
          .mountStore(workspaceId, { storeId: row.store_id, access: row.access })
          .catch((e) => console.error(`[patch-attach ${workspaceId}] Mount RPC failed:`, e))
      }
      // Any field on this row surfaces in the platform prompt's Memory Stores
      // section — refresh so the agent sees the change without a pod restart.
      notifyAgentReload(workspaceId, ['config']).catch(() => {})
    }
    return c.json(row, 200)
  },
)

attachments.openapi(
  createRoute({
    method: 'delete',
    path: '/{workspaceId}/memory-attachments/{storeId}',
    tags: ['workspace-memory'],
    security: [{ bearerAuth: [] }],
    request: { params: WsAttachmentParam },
    responses: {
      200: { description: 'OK', content: { 'application/json': { schema: SuccessSchema } } },
      403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const user = c.get('user')
    const { workspaceId, storeId } = c.req.valid('param')
    const wsAccess = await assertWorkspaceOwner(workspaceId, user.sub)
    if (!wsAccess.ok) {
      if (wsAccess.status === 403) return c.json({ error: wsAccess.error }, 403)
      return c.json({ error: wsAccess.error }, 404)
    }
    const ok = await detachStore(workspaceId, storeId)
    if (!ok) return c.json({ error: 'attachment not found' }, 404)
    // Sidecar always present (template v4 onward) and lives independent of
    // attachment count — detaching the last store just leaves an empty
    // /mnt/memory/. The platform prompt's Memory Stores section auto-hides
    // when the count hits zero, so detach is purely Unmount RPC + reload.
    const ws = await getWorkspace(workspaceId)
    if (ws?.status === 'running') {
      await memoryFuse
        .unmountStore(workspaceId, storeId)
        .catch((e) => console.error(`[detach ${workspaceId}] Unmount RPC failed:`, e))
      notifyAgentReload(workspaceId, ['config']).catch(() => {})
    }
    return c.json({ success: true }, 200)
  },
)

export { stores as memoryStoresRoutes, attachments as workspaceMemoryAttachmentRoutes }
