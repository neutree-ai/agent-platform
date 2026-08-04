import { Hono } from 'hono'
import { notifyAgentReload } from '../lib/workspace-address'
import { listAfsMountsForWorkspace } from '../services/db/afs-shares'
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
