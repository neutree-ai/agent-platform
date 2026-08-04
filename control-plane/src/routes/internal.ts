import { Hono } from 'hono'
import { notifyAgentReload } from '../lib/workspace-address'
import { listAfsMountsForWorkspace } from '../services/db/afs-shares'
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
} from '../services/db/memory'
import { broadcastStoreInvalidate } from '../services/memory-fuse'
import { skillRepo } from '../services/skills-composition'

const internal = new Hono()

// Health check
internal.get('/health', (c) => c.json({ status: 'ok' }))

// afs-fuse sidecar boot pull: list of AFS shares this ws should mount.
// Daemon hits this on startup (via AFS_BOOTSTRAP_URL env), Mounts each at
// /mnt/afs/<share_name>. This is the single source of truth for "what
// should be mounted in this pod" — cp no longer pushes remounts from
// reconcile/lifecycle because the pod's own startup is a more reliable
// event source than cp's deployment-level watch. Grant/revoke during a
// running pod still go through mountAtWorkspace/unmountAtWorkspace
// (push), since those happen mid-lifetime when no startup event fires.
internal.get('/workspaces/:id/afs-mounts', async (c) => {
  const id = c.req.param('id')
  const rows = await listAfsMountsForWorkspace(id)
  return c.json({
    mounts: rows.map((r) => ({
      id: r.afs_dir_id,
      access_key: r.access_key,
      mountpoint: `/mnt/afs/${r.share_name}`,
      readonly: r.permission === 'read_only',
    })),
  })
})

// memory-fuse sidecar boot pull: list of stores this ws should mount.
// Daemon hits this on startup, mounts each at /mnt/memory/<store_id>/, and
// afterwards stays in sync via cp's Mount/Unmount gRPC pushes on
// attach/detach/patch.
internal.get('/workspaces/:id/memory-attachments', async (c) => {
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

// memory-fuse file IO. The sidecar reaches these instead of the user-facing
// /api/memory-stores/* surface so it doesn't need a bearer token; cluster
// network isolation is the trust boundary (same pattern as the rest of
// /_cp). Authorisation reduces to "the store is currently attached to the
// daemon's workspace" — we read that from the path-scoped wsId. Versions
// record actor_kind='agent', actor_id=workspace_id so the audit log
// distinguishes agent writes from user writes.
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

internal.get('/workspaces/:wsId/memory-stores/:storeId/memories', async (c) => {
  const { wsId, storeId } = c.req.param()
  if (!(await requireAttached(wsId, storeId))) {
    return c.json({ error: 'store not attached to workspace' }, 404)
  }
  const rows = await listMemories(storeId)
  return c.json({ memories: rows })
})

internal.get('/workspaces/:wsId/memory-stores/:storeId/memory/*', async (c) => {
  const { wsId, storeId } = c.req.param()
  if (!(await requireAttached(wsId, storeId))) {
    return c.json({ error: 'store not attached to workspace' }, 404)
  }
  const path = extractMemoryPath(c.req.path, storeId)
  const m = await getMemoryByPath(storeId, path)
  if (!m) return c.json({ error: 'memory not found' }, 404)
  return c.json(m)
})

internal.put('/workspaces/:wsId/memory-stores/:storeId/memory/*', async (c) => {
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
})

internal.delete('/workspaces/:wsId/memory-stores/:storeId/memory/*', async (c) => {
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
})

// memory-fuse rename(2): atomic move of one memory to another path within the
// same store. Backs the FUSE NodeRenamer so `mv`, `sed -i`, and editor
// write-temp-then-rename atomic saves work without the daemon emulating it as
// a non-atomic PUT+DELETE (which would also orphan the memory's history).
internal.post('/workspaces/:wsId/memory-stores/:storeId/memory-move', async (c) => {
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
})

// Reload fanout for a skill. Called by the scheduler's skill-reload worker
// (not the user request path) after a publish/sync/set-active enqueues a job.
// Enumerates the workspaces mounting the skill and tells each agent to reload,
// bounded so a popular skill doesn't open one socket per workspace at once.
//
// Returns {notified, failed}; the worker throws on failed>0 so pg-boss retries
// the whole job (reload is idempotent + 304-cheap). Exhausted retries land in
// the shared dead-letter queue.
const RELOAD_FANOUT_CONCURRENCY = 10
internal.post('/skills/:id/reload-fanout', async (c) => {
  const id = c.req.param('id')
  const workspaces = await skillRepo.listWorkspacesUsingSkill(id)

  let notified = 0
  let failed = 0
  // Simple bounded worker pool over the workspace list.
  let cursor = 0
  const runWorker = async () => {
    while (cursor < workspaces.length) {
      const ws = workspaces[cursor++]
      const ok = await notifyAgentReload(ws.id, ['skills'])
      if (ok) notified++
      else failed++
    }
  }
  const workers = Array.from(
    { length: Math.min(RELOAD_FANOUT_CONCURRENCY, workspaces.length) },
    runWorker,
  )
  await Promise.all(workers)

  return c.json({ total: workspaces.length, notified, failed })
})

export default internal
