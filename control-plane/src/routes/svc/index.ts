import { Hono } from 'hono'
import { notifyAgentReload } from '../../lib/workspace-address'
import { serviceAuth } from '../../middleware/service-auth'
import { skillRepo } from '../../services/skills-composition'

// Platform-internal service endpoints (/svc/v1/*). Guarded by a shared key
// rather than a workspace or environment principal: the caller is one of our
// own background services acting on the fleet, not on behalf of any single
// tenant. Plain Hono, so none of this reaches the OpenAPI document.
const svc = new Hono()

svc.use('*', serviceAuth)

// Reload fanout for a skill. Called by the scheduler's skill-reload worker
// (not the user request path) after a publish/sync/set-active enqueues a job.
// Enumerates the workspaces mounting the skill and tells each agent to reload,
// bounded so a popular skill doesn't open one socket per workspace at once.
//
// Returns {notified, failed}; the worker throws on failed>0 so pg-boss retries
// the whole job (reload is idempotent + 304-cheap). Exhausted retries land in
// the shared dead-letter queue.
const RELOAD_FANOUT_CONCURRENCY = 10
svc.post('/v1/skills/:id/reload-fanout', async (c) => {
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

export default svc
