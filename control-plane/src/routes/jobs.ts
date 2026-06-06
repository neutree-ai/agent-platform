import { Hono } from 'hono'
import * as jobs from '../lib/jobs'
import type { AppEnv } from '../lib/types'
import { getPlatformToken } from '../services/db/shares'
import { getWorkspace } from '../services/db/workspaces'

const jobRoutes = new Hono<AppEnv>()

// POST /api/workspaces/:id/jobs — create a job
jobRoutes.post('/:id/jobs', async (c) => {
  const workspaceId = c.req.param('id')
  const currentUser = c.get('user')

  const workspace = await getWorkspace(workspaceId)
  if (!workspace || workspace.user_id !== currentUser.sub) {
    return c.json({ error: 'Workspace not found' }, 404)
  }

  const body = await c.req.json<{
    prompt: string
    trigger?: jobs.JobTrigger
    scheduled_for?: string
    retry_limit?: number
    expire_in_seconds?: number
  }>()

  if (!body.prompt) {
    return c.json({ error: 'prompt is required' }, 400)
  }

  const serviceToken = await getPlatformToken(currentUser.sub)
  if (!serviceToken) {
    return c.json({ error: 'No platform token available for current user' }, 400)
  }

  const jobId = await jobs.sendJob(
    {
      workspace_id: workspaceId,
      prompt: body.prompt,
      trigger: body.trigger || { type: 'manual' },
      service_token: serviceToken,
    },
    {
      startAfter: body.scheduled_for,
      retryLimit: body.retry_limit,
      expireInSeconds: body.expire_in_seconds,
    },
  )

  return c.json({ id: jobId }, 201)
})

// GET /api/workspaces/:id/jobs — list jobs
jobRoutes.get('/:id/jobs', async (c) => {
  const workspaceId = c.req.param('id')
  const currentUser = c.get('user')

  const workspace = await getWorkspace(workspaceId)
  if (!workspace || workspace.user_id !== currentUser.sub) {
    return c.json({ error: 'Workspace not found' }, 404)
  }

  const limit = Number(c.req.query('limit') || 50)
  const offset = Number(c.req.query('offset') || 0)
  const rows = await jobs.listJobs(workspaceId, { limit, offset })

  return c.json({ jobs: rows })
})

// GET /api/workspaces/:id/jobs/:jobId — get job detail
jobRoutes.get('/:id/jobs/:jobId', async (c) => {
  const workspaceId = c.req.param('id')
  const jobId = c.req.param('jobId')
  const currentUser = c.get('user')

  const workspace = await getWorkspace(workspaceId)
  if (!workspace || workspace.user_id !== currentUser.sub) {
    return c.json({ error: 'Workspace not found' }, 404)
  }

  const job = await jobs.getJob(jobId)
  if (!job || (job.data as jobs.JobData).workspace_id !== workspaceId) {
    return c.json({ error: 'Job not found' }, 404)
  }

  return c.json({ job })
})

export default jobRoutes
