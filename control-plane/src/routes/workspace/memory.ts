import { Hono } from 'hono'
import type { WorkspaceAppEnv } from '../../lib/types'
import { requireWorkspaceParam } from '../../middleware/workspace-auth'
import {
  PathConflictError,
  PreconditionFailedError,
  deleteMemoryByPath,
  getAttachment,
  getMemoryByPath,
  listAttachmentsForWorkspace,
  listMemories,
  moveMemory,
  putMemory,
} from '../../services/db/memory'
import { broadcastStoreInvalidate } from '../../services/memory-fuse'

const memory = new Hono<WorkspaceAppEnv>()

// memory-fuse sidecar boot pull: list of stores this ws should mount.
// Daemon hits this on startup, mounts each at /mnt/memory/<store_id>/, and
// afterwards stays in sync via cp's Mount/Unmount gRPC pushes on
// attach/detach/patch.
memory.get('/v1/workspaces/:id/memory-attachments', requireWorkspaceParam(), async (c) => {
  const id = c.req.param('id')
  const rows = await listAttachmentsForWorkspace(id)
  return c.json({
    attachments: rows.map((r) => ({
      store_id: r.store_id,
      access: r.access,
      instructions: r.instructions,
    })),
  })
})

// memory-fuse file IO. The sidecar reaches these rather than the user-facing
// /api/memory-stores/* surface because it authenticates as a workspace, not as
// a user: its token resolves to one workspace id, requireWorkspaceParam pins
// the path to it, and the attachment row then decides which stores within that
// workspace are reachable. Versions record actor_kind='agent',
// actor_id=workspace_id so the audit log distinguishes agent writes from user
// writes.
async function requireAttached(workspaceId: string, storeId: string) {
  const a = await getAttachment(workspaceId, storeId)
  if (!a) return null
  return a
}

function extractMemoryPath(reqPath: string, storeId: string): string {
  const marker = `/memory-stores/${storeId}/memory`
  const idx = reqPath.indexOf(marker)
  if (idx < 0) return '/'
  const tail = reqPath.slice(idx + marker.length)
  return tail.startsWith('/') ? tail : `/${tail}`
}

memory.get(
  '/v1/workspaces/:wsId/memory-stores/:storeId/memories',
  requireWorkspaceParam('wsId'),
  async (c) => {
    const { wsId, storeId } = c.req.param()
    if (!(await requireAttached(wsId, storeId))) {
      return c.json({ error: 'store not attached to workspace' }, 404)
    }
    const rows = await listMemories(storeId)
    return c.json({ memories: rows })
  },
)

memory.get(
  '/v1/workspaces/:wsId/memory-stores/:storeId/memory/*',
  requireWorkspaceParam('wsId'),
  async (c) => {
    const { wsId, storeId } = c.req.param()
    if (!(await requireAttached(wsId, storeId))) {
      return c.json({ error: 'store not attached to workspace' }, 404)
    }
    const path = extractMemoryPath(c.req.path, storeId)
    const m = await getMemoryByPath(storeId, path)
    if (!m) return c.json({ error: 'memory not found' }, 404)
    return c.json(m)
  },
)

memory.put(
  '/v1/workspaces/:wsId/memory-stores/:storeId/memory/*',
  requireWorkspaceParam('wsId'),
  async (c) => {
    const { wsId, storeId } = c.req.param()
    const att = await requireAttached(wsId, storeId)
    if (!att) return c.json({ error: 'store not attached to workspace' }, 404)
    if (att.access === 'read_only') return c.json({ error: 'store is read-only' }, 403)
    const path = extractMemoryPath(c.req.path, storeId)
    const body = (await c.req.json().catch(() => ({}))) as {
      content?: string
      description?: string
      mem_type?: string
      if_match_sha256?: string
    }
    if (typeof body.content !== 'string') return c.json({ error: 'invalid body' }, 400)
    try {
      const m = await putMemory({
        storeId,
        path,
        content: body.content,
        description: body.description,
        memType: body.mem_type,
        ifMatchSha256: body.if_match_sha256,
        actorKind: 'agent',
        actorId: wsId,
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
  },
)

memory.delete(
  '/v1/workspaces/:wsId/memory-stores/:storeId/memory/*',
  requireWorkspaceParam('wsId'),
  async (c) => {
    const { wsId, storeId } = c.req.param()
    const att = await requireAttached(wsId, storeId)
    if (!att) return c.json({ error: 'store not attached to workspace' }, 404)
    if (att.access === 'read_only') return c.json({ error: 'store is read-only' }, 403)
    const path = extractMemoryPath(c.req.path, storeId)
    const body = (await c.req.json().catch(() => ({}))) as { if_match_sha256?: string }
    try {
      const ok = await deleteMemoryByPath({
        storeId,
        path,
        ifMatchSha256: body.if_match_sha256,
        actorKind: 'agent',
        actorId: wsId,
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
  },
)

// memory-fuse rename(2): atomic move of one memory to another path within the
// same store. Backs the FUSE NodeRenamer so `mv`, `sed -i`, and editor
// write-temp-then-rename atomic saves work without the daemon emulating it as
// a non-atomic PUT+DELETE (which would also orphan the memory's history).
memory.post(
  '/v1/workspaces/:wsId/memory-stores/:storeId/memory-move',
  requireWorkspaceParam('wsId'),
  async (c) => {
    const { wsId, storeId } = c.req.param()
    const att = await requireAttached(wsId, storeId)
    if (!att) return c.json({ error: 'store not attached to workspace' }, 404)
    if (att.access === 'read_only') return c.json({ error: 'store is read-only' }, 403)
    const body = (await c.req.json().catch(() => ({}))) as {
      from?: string
      to?: string
      overwrite?: boolean
      if_match_sha256?: string
    }
    if (
      typeof body.from !== 'string' ||
      typeof body.to !== 'string' ||
      !body.from.startsWith('/') ||
      !body.to.startsWith('/')
    ) {
      return c.json({ error: 'invalid body: from/to must be absolute paths' }, 400)
    }
    try {
      const m = await moveMemory({
        storeId,
        fromPath: body.from,
        toPath: body.to,
        overwrite: body.overwrite ?? false,
        ifMatchSha256: body.if_match_sha256,
        actorKind: 'agent',
        actorId: wsId,
      })
      if (!m) return c.json({ error: 'memory not found' }, 404)
      broadcastStoreInvalidate(storeId)
      return c.json(m)
    } catch (e) {
      if (e instanceof PathConflictError)
        return c.json({ error: 'memory already exists at destination' }, 409)
      if (e instanceof PreconditionFailedError)
        return c.json({ error: 'sha256 precondition failed', current_sha256: e.currentSha }, 412)
      throw e
    }
  },
)

export default memory
