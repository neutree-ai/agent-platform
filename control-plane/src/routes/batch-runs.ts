import { Hono } from 'hono'
import * as jobs from '../lib/jobs'
import type { AppEnv } from '../lib/types'
import {
  createBatchRun,
  createBatchTask,
  getBatchRun,
  getBatchRunStats,
  listBatchRuns,
  listBatchTasks,
  updateBatchRunStatus,
  updateBatchTask,
} from '../services/db/batch'
import { getPlatformToken } from '../services/db/shares'
import { getWorkspace } from '../services/db/workspaces'

const batchRunRoutes = new Hono<AppEnv>()

// POST /api/batch-runs — create a batch run and enqueue tasks
batchRunRoutes.post('/', async (c) => {
  const currentUser = c.get('user')

  const body = await c.req.json<{
    name?: string
    concurrency?: number
    tasks: { workspace_id: string; prompt: string }[]
  }>()

  if (!body.tasks?.length) {
    return c.json({ error: 'tasks array is required and must not be empty' }, 400)
  }

  // Validate all workspaces belong to user
  const wsIds = [...new Set(body.tasks.map((t) => t.workspace_id))]
  for (const wsId of wsIds) {
    const ws = await getWorkspace(wsId)
    if (!ws || ws.user_id !== currentUser.sub) {
      return c.json({ error: `Workspace not found: ${wsId}` }, 404)
    }
  }

  const serviceToken = await getPlatformToken(currentUser.sub)
  if (!serviceToken) {
    return c.json({ error: 'No platform token available for current user' }, 400)
  }

  // Create batch run
  const batchRun = await createBatchRun({
    user_id: currentUser.sub,
    name: body.name || '',
    concurrency: body.concurrency,
  })

  // Create tasks and enqueue jobs
  for (const task of body.tasks) {
    if (!task.prompt) {
      // Rollback: in practice we'd want a transaction, but for now skip invalid tasks
      continue
    }
    const batchTask = await createBatchTask({
      batch_run_id: batchRun.id,
      workspace_id: task.workspace_id,
      prompt: task.prompt,
    })

    await jobs.sendJob({
      workspace_id: task.workspace_id,
      prompt: task.prompt,
      trigger: {
        type: 'batch',
        payload: { batch_run_id: batchRun.id, batch_task_id: batchTask.id },
      },
      service_token: serviceToken,
    })
  }

  // Mark as running
  await updateBatchRunStatus(batchRun.id, 'running')

  const stats = await getBatchRunStats(batchRun.id)
  return c.json({ ...batchRun, status: 'running', stats }, 201)
})

// GET /api/batch-runs — list batch runs for current user
batchRunRoutes.get('/', async (c) => {
  const currentUser = c.get('user')
  const runs = await listBatchRuns(currentUser.sub)
  return c.json({ batch_runs: runs })
})

// GET /api/batch-runs/:id — get batch run with tasks and stats
batchRunRoutes.get('/:id', async (c) => {
  const currentUser = c.get('user')
  const id = c.req.param('id')

  const run = await getBatchRun(id)
  if (!run || run.user_id !== currentUser.sub) {
    return c.json({ error: 'Batch run not found' }, 404)
  }

  const tasks = await listBatchTasks(id)
  const stats = await getBatchRunStats(id)

  return c.json({ ...run, tasks, stats })
})

// DELETE /api/batch-runs/:id — cancel a batch run
batchRunRoutes.delete('/:id', async (c) => {
  const currentUser = c.get('user')
  const id = c.req.param('id')

  const run = await getBatchRun(id)
  if (!run || run.user_id !== currentUser.sub) {
    return c.json({ error: 'Batch run not found' }, 404)
  }

  if (run.status === 'completed' || run.status === 'cancelled') {
    return c.json({ error: `Batch run already ${run.status}` }, 400)
  }

  // Cancel all queued tasks
  const tasks = await listBatchTasks(id)
  for (const task of tasks) {
    if (task.status === 'queued') {
      await updateBatchTask(task.id, { status: 'cancelled' })
    }
    // Note: running tasks will complete naturally; we don't interrupt them
  }

  const stats = await getBatchRunStats(id)
  await updateBatchRunStatus(id, 'cancelled', stats)

  return c.json({ success: true })
})

export default batchRunRoutes
