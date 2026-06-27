import { Hono } from 'hono'
import type { ApiCredential, ApiWorkspaceConfig } from '../../../internal/types/api'
import { getWorkspaceAddress, notifyAgentReload } from '../lib/workspace-address'
import { listAfsMountsForWorkspace } from '../services/db/afs-shares'
import { listWorkspaceCredentials } from '../services/db/credentials'
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
import { getUser } from '../services/db/users'
import { getWorkspace, getWorkspaceConfig, updateWorkspace } from '../services/db/workspaces'
import * as k8s from '../services/k8s'
import { getToken, serverOriginFromUrl } from '../services/mcp-oauth'
import { broadcastStoreInvalidate } from '../services/memory-fuse'
import { bumpWorkspaceSpec } from '../services/placement'
import { skillRepo, skillsService } from '../services/skills-composition'
import { skillsContentFetch, skillsContentUrl } from '../services/skills-content'
import { ConflictError, NotAllowedError, SkillNotFoundError } from '../services/skills-errors'
import { applyWorkspaceConfigUpdate } from '../services/workspace-config'
import { encodeOrigin } from './mcp-proxy'

const internal = new Hono()

// Health check
internal.get('/health', (c) => c.json({ status: 'ok' }))

// Control plane info
internal.get('/info', (c) => {
  return c.json({
    name: '@neutree-ai/control-plane',
    version: '0.1.0',
  })
})

// List all K8s instances (admin/debug)
internal.get('/instances', async (c) => {
  try {
    const instances = await k8s.listInstances()
    return c.json({ instances })
  } catch (e: any) {
    console.error('Failed to list instances:', e)
    return c.json({ error: e.message }, 500)
  }
})

// Get K8s instance by workspace ID (admin/debug)
internal.get('/instances/:workspaceId', async (c) => {
  try {
    const workspaceId = c.req.param('workspaceId')
    const instance = await k8s.getInstance(workspaceId)

    if (!instance) {
      return c.json({ error: 'Instance not found' }, 404)
    }

    return c.json({ instance })
  } catch (e: any) {
    console.error('Failed to get instance:', e)
    return c.json({ error: e.message }, 500)
  }
})

// Delete K8s instance by workspace ID (admin/debug)
internal.delete('/instances/:workspaceId', async (c) => {
  try {
    const workspaceId = c.req.param('workspaceId')
    const deleted = await k8s.deleteInstance(workspaceId)

    if (!deleted) {
      return c.json({ error: 'Instance not found' }, 404)
    }

    return c.json({ message: 'Instance deleted' })
  } catch (e: any) {
    console.error('Failed to delete instance:', e)
    return c.json({ error: e.message }, 500)
  }
})

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

// Get workspace config
internal.get('/workspaces/:id/config', async (c) => {
  const id = c.req.param('id')
  const config = await getWorkspaceConfig(id)
  if (!config) {
    return c.json({ error: 'Config not found' }, 404)
  }
  // Inject headers and rewrite URLs in MCP server configs at serve time:
  // 1. X-Workspace-ID for all servers
  // 2. Rewrite URL to CP proxy for OAuth-connected servers (token injected at proxy time)
  const CP_INTERNAL_URL =
    process.env.CONTROL_PLANE_URL || 'http://nap-cp.default.svc.cluster.local:3000'
  const workspace = await getWorkspace(id)
  const user = workspace?.user_id ? await getUser(workspace.user_id) : null
  let mcpConfig = config.mcp_config
  try {
    const parsed = JSON.parse(mcpConfig)
    if (!parsed.mcpServers) parsed.mcpServers = {}
    // Note: `tos-platform` is no longer injected here. Sidecars are
    // responsible for wiring the platform MCP server per-turn (claude-code)
    // or per-session (codex) so the X-Task-Id header can vary with the
    // teamwork task context. Keeping a static injection here would create
    // a duplicate definition that conflicts with the sidecar's dynamic one.
    if (parsed.mcpServers) {
      for (const server of Object.values(parsed.mcpServers) as any[]) {
        // Inject workspace context for all MCP servers
        if (server.url) {
          server.headers = { ...server.headers, 'X-Workspace-ID': id, 'X-Agent-ID': id }
        }
        // Rewrite URL to CP proxy for servers with OAuth tokens
        if (workspace?.user_id && server.url) {
          try {
            const origin = serverOriginFromUrl(server.url)
            const token = await getToken(workspace.user_id, origin)
            if (token) {
              const encodedOrig = encodeOrigin(origin)
              const path = new URL(server.url).pathname
              server.url = `${CP_INTERNAL_URL}/_cp/mcp/${workspace.user_id}/${encodedOrig}${path}`
            }
          } catch {
            // skip if origin parsing fails
          }
        }
      }
      mcpConfig = JSON.stringify(parsed)
    }
  } catch {
    // leave mcp_config as-is if not valid JSON
  }

  const attachments = await listAttachmentsForWorkspace(id)
  // Snapshot each store's MEMORY.md index so the platform prompt can inline it
  // — saves the agent a `cat` round-trip on session start. Stores without an
  // index report null and the template just omits the block.
  const indexByStore = new Map<string, string | null>()
  await Promise.all(
    attachments.map(async (a) => {
      const m = await getMemoryByPath(a.store_id, '/MEMORY.md')
      indexByStore.set(a.store_id, m?.content ?? null)
    }),
  )
  const response: ApiWorkspaceConfig = {
    agent_type: config.agent_type,
    provider_id: config.provider_id,
    prompt_id: config.prompt_id,
    prompt_name: config.prompt_name,
    prompt_content: config.prompt_content,
    template_id: config.template_id,
    template_version: config.template_version,
    template_name: config.template_name,
    template_latest_version: config.template_latest_version,
    provider_type: config.provider_type,
    model: config.model,
    base_url: config.base_url,
    api_key: config.api_key,
    small_model: config.small_model,
    system_prompt: config.system_prompt,
    mcp_config: mcpConfig,
    agent_settings: config.agent_settings,
    compute_resources: config.compute_resources ?? {},
    auto_start: config.auto_start ?? true,
    user_display_name: user?.display_name || user?.username || null,
    memory_attachments: attachments.map((a) => ({
      store_id: a.store_id,
      store_name: a.store_name,
      store_description: a.store_description,
      access: a.access,
      instructions: a.instructions,
      index_content: indexByStore.get(a.store_id) ?? null,
    })),
  }
  return c.json(response)
})

// Update workspace config
internal.put('/workspaces/:id/config', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<Partial<ApiWorkspaceConfig>>()
  let reloaded = false
  try {
    const result = await applyWorkspaceConfigUpdate(id, body)
    reloaded = result.reloaded
  } catch (e: any) {
    if ((e as Error).message === 'workspace not found') {
      return c.json({ error: 'Workspace not found' }, 404)
    }
    throw e
  }
  const workspace = await getWorkspace(id)

  // If compute_resources changed and workspace is running, apply to K8s
  if (body.compute_resources && workspace?.status === 'running') {
    const cr = body.compute_resources
    try {
      // Control inversion (P1): bump the spec; the env-runner re-applies with the
      // new cpu/mem and resizes the PVC (one spec covers both).
      if (cr.cpu_request || cr.cpu_limit || cr.memory_request || cr.memory_limit || cr.storage) {
        await bumpWorkspaceSpec(id)
        await updateWorkspace(id, { status: 'starting' })
      }
    } catch (e: any) {
      console.error(`[config] Failed to apply compute resources for workspace=${id}:`, e.message)
    }
  }

  return c.json({ success: true, reloaded })
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

// Delete a skill. p3: cp doesn't own skill writes anymore — scs does. Route
// this through the orchestrating service so we keep the pre-delete blocker
// check + workspace reload coupling.
internal.delete('/skills/:id', async (c) => {
  const id = c.req.param('id')
  // The internal API has no per-user auth context; use the skill's owner as
  // the actor so the service-layer ACL passes.
  const meta = await skillRepo.getSkillMeta(id)
  if (!meta) return c.json({ error: 'Skill not found' }, 404)
  try {
    await skillsService.remove(meta.user_id, id)
    return c.json({ success: true })
  } catch (e) {
    if (e instanceof SkillNotFoundError) return c.json({ error: e.message }, 404)
    if (e instanceof NotAllowedError) return c.json({ error: e.message }, 403)
    if (e instanceof ConflictError) return c.json({ error: e.message }, 409)
    throw e
  }
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

// Set workspace skills (full replace) + trigger agent reload.
// p3: body now carries UUIDs.
internal.put('/workspaces/:id/skills', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<{ skills: string[] }>()
  try {
    const { reloaded } = await skillsService.attachToWorkspace(id, body.skills)
    return c.json({ success: true, reloaded })
  } catch (e: any) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg === 'workspace not found') return c.json({ error: 'Workspace not found' }, 404)
    if (msg.startsWith('skills not visible')) return c.json({ error: msg }, 403)
    throw e
  }
})

// Execute a command inside a workspace container (proxied to agent server)
internal.post('/workspaces/:id/exec', async (c) => {
  const id = c.req.param('id')
  const workspace = await getWorkspace(id)
  if (!workspace || workspace.status !== 'running') {
    return c.json({ error: 'Workspace not running' }, 503)
  }

  const address = getWorkspaceAddress(workspace.id)

  const body = await c.req.text()
  const res = await fetch(`${address}/exec`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
  return new Response(res.body, {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  })
})

// Get user credentials for a workspace (agent-facing, contains values)
internal.get('/workspaces/:id/credentials', async (c) => {
  const id = c.req.param('id')
  const workspace = await getWorkspace(id)
  if (!workspace) {
    return c.json({ error: 'Workspace not found' }, 404)
  }
  const creds = await listWorkspaceCredentials(id, workspace.user_id)
  const response: ApiCredential[] = creds.map((cr) => ({
    name: cr.name,
    value: cr.value,
    inject: cr.inject,
    path: cr.path,
    mode: cr.mode,
    scope: cr.scope,
    status: cr.status,
  }))
  return c.json(response)
})

export default internal
