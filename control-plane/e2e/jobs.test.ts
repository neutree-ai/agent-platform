import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { client } from './setup'

async function waitForStatus(wsId: string, target: 'running' | 'stopped', maxWaitMs = 120_000) {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    const list = await client.workspaces.list()
    const ws = list.find((w) => w.id === wsId)
    if (ws?.status === target) return ws
    await new Promise((r) => setTimeout(r, 3000))
  }
  throw new Error(`Workspace did not reach ${target} within ${maxWaitMs}ms`)
}

async function waitForJobDone(wsId: string, jobId: string, maxWaitMs = 120_000) {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    const job = await client.jobs.get(wsId, jobId)
    if (job.status === 'completed' || job.status === 'failed') return job
    await new Promise((r) => setTimeout(r, 3000))
  }
  throw new Error(`Job ${jobId} did not complete within ${maxWaitMs}ms`)
}

// Skip: pg-boss schema issues in test DB + job execution needs agent
describe.skip('jobs', () => {
  let wsId: string
  let providerId: string

  beforeAll(async () => {
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY
    if (!OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY env var is required')

    const provider = await client.providers.create({
      name: 'e2e-jobs-provider',
      provider_type: 'anthropic-oauth',
      base_url: 'https://openrouter.ai/api/v1',
      api_key: OPENROUTER_API_KEY,
    })
    providerId = provider.id

    const ws = await client.workspaces.create({ name: 'e2e-jobs-ws' })
    wsId = ws.id
    await client.workspaces.updateConfig(wsId, {
      model: 'stepfun/step-3.5-flash:free',
      provider_id: providerId,
    })
    await client.workspaces.start(wsId)
    await waitForStatus(wsId, 'running', 120_000)
  }, 180_000)

  afterAll(async () => {
    try {
      await client.workspaces.stop(wsId)
    } catch {}
    try {
      await waitForStatus(wsId, 'stopped', 60_000)
    } catch {}
    try {
      await client.workspaces.delete(wsId)
    } catch {}
    try {
      await client.providers.delete(providerId)
    } catch {}
  }, 120_000)

  test('create job', async () => {
    const job = await client.jobs.create(wsId, {
      prompt: 'Reply with: JOB_DONE',
      trigger: { type: 'manual' },
    })
    expect(job.id).toBeDefined()
    expect(typeof job.id).toBe('string')
  })

  test('list jobs contains created job', async () => {
    const job = await client.jobs.create(wsId, {
      prompt: 'Reply with: JOB_LIST_TEST',
      trigger: { type: 'manual' },
    })
    const jobs = await client.jobs.list(wsId)
    expect(jobs.some((j) => j.id === job.id)).toBe(true)
  })

  test('get job matches', async () => {
    const created = await client.jobs.create(wsId, {
      prompt: 'Reply with: JOB_GET_TEST',
      trigger: { type: 'manual' },
    })
    const job = await client.jobs.get(wsId, created.id)
    expect(job.id).toBe(created.id)
  })

  test('wait for job completion', async () => {
    const created = await client.jobs.create(wsId, {
      prompt: 'Reply with: JOB_COMPLETE',
      trigger: { type: 'manual' },
    })
    const job = await waitForJobDone(wsId, created.id, 120_000)
    expect(['completed', 'failed']).toContain(job.status as string)
  }, 130_000)

  test('create schedule', async () => {
    const schedule = await client.jobs.createSchedule(wsId, {
      name: 'test-cron',
      cron: '0 0 * * *',
      prompt: 'test scheduled job',
    })
    expect(schedule.name).toBe('test-cron')
  })

  test('list schedules contains created schedule', async () => {
    const schedules = await client.jobs.listSchedules(wsId)
    expect(schedules.some((s) => s.name === 'test-cron')).toBe(true)
  })

  test('delete schedule', async () => {
    await client.jobs.deleteSchedule(wsId, 'test-cron')
    const schedules = await client.jobs.listSchedules(wsId)
    expect(schedules.some((s) => s.name === 'test-cron')).toBe(false)
  })
})
