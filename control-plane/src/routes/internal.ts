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
import { getWorkspace } from '../services/db/workspaces'
import { broadcastStoreInvalidate } from '../services/memory-fuse'
import { skillRepo } from '../services/skills-composition'
import { skillsContentFetch, skillsContentUrl } from '../services/skills-content'

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

// List all skills (metadata only)
internal.get('/skills', async (c) => {
  const skills = await skillRepo.listSkills()
  return c.json(skills)
})

// Download skill package (tar.gz binary). p3 hot path: the workspace agent hits
// it on startup to stamp skills onto its filesystem. We proxy to
// skills-content-service so cp never materializes the tarball.
//
// Route keys on skill UUID now — names are no longer globally unique, so the
// previous `/skills/:name` form can't disambiguate cross-owner. agent-skills
// resolves `id` at list time (via `/_cp/workspaces/:id/skills`) and uses it
// here.
const PACKAGE_PASSTHROUGH = ['Content-Type', 'Content-Length', 'ETag', 'Last-Modified']
internal.get('/skills/:id/package', async (c) => {
  const id = c.req.param('id')
  const url = skillsContentUrl(id, '/package')
  // Forward the agent's conditional-download header so scs can answer 304 when
  // the active version is unchanged (see skills-content-service package route).
  const inm = c.req.header('If-None-Match')
  const result = await skillsContentFetch(
    url,
    c.req.raw.signal,
    inm ? { 'If-None-Match': inm } : undefined,
  )
  if (!result.ok) return c.json({ error: result.error }, 502)
  const { response } = result
  if (response.status === 404) return c.json({ error: 'Skill not found' }, 404)
  if (response.status === 304) {
    const headers = new Headers()
    const etag = response.headers.get('ETag')
    if (etag) headers.set('ETag', etag)
    return new Response(null, { status: 304, headers })
  }
  if (!response.ok) return c.json({ error: `Upstream returned ${response.status}` }, 502)
  const headers = new Headers()
  for (const h of PACKAGE_PASSTHROUGH) {
    const v = response.headers.get(h)
    if (v) headers.set(h, v)
  }
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/gzip')
  return new Response(response.body, { status: response.status, headers })
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

// Get workspace skill list. p3: returns the canonical UUIDs plus display names
// resolved via JOIN. Old shape exposed only names, but names aren't globally
// unique now — agents and the web app should switch to id-keyed lookups.
internal.get('/workspaces/:id/skills', async (c) => {
  const id = c.req.param('id')
  // One JOIN query for the skill rows + one for the workspace owner, in
  // parallel. (Previously this fanned out into 1 + N×(getSkillMeta + getSource)
  // round-trips per workspace skill.)
  const [workspace, rows] = await Promise.all([
    getWorkspace(id),
    skillRepo.getWorkspaceSkillsForAgent(id),
  ])
  const wsOwner = workspace?.user_id ?? null

  // p3 schema dropped `skills.git_source` — source kind comes from the joined
  // `skill_sources` row.
  const skills = rows.map((s) => ({
    id: s.id,
    name: s.name ?? '(unknown)',
    editable: s.user_id === wsOwner || !s.user_id,
    gitSource: s.source_kind === 'git',
  }))
  // TODO(agent-skills): legacy agent-skills clients consume `{ name, editable,
  // gitSource }` shape. Once the agent-side client is updated to read `id`,
  // drop the duplicated `name` field at the top level.
  return c.json({ skills })
})

export default internal
