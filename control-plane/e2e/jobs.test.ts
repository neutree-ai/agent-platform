import { afterAll, beforeAll, expect, test } from 'vitest'
import { createLlmProvider, createRunningWorkspace, waitForStatus } from './fixtures'
import { client, describeEachCore, scoped } from './setup'

async function waitForJobDone(wsId: string, jobId: string, maxWaitMs = 120_000) {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    const job = await client.jobs.get(wsId, jobId)
    // pg-boss calls it `state`, and reports cancelled jobs as terminal too.
    if (job.state === 'completed' || job.state === 'failed' || job.state === 'cancelled') return job
    await new Promise((r) => setTimeout(r, 3000))
  }
  throw new Error(`Job ${jobId} did not complete within ${maxWaitMs}ms`)
}

describeEachCore('jobs', (agentType) => {
  let wsId: string
  let providerId: string
  let scheduleId: string

  beforeAll(async () => {
    const provider = await createLlmProvider(`jobs-provider-${agentType}`)
    providerId = provider.id

    const ws = await createRunningWorkspace(`jobs-ws-${agentType}`, providerId, agentType)
    wsId = ws.id
  }, 300_000)

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
    const listed = jobs.find((j) => j.id === job.id)
    expect(listed).toBeDefined()
    // The queue payload carries the caller's platform token; it must not surface.
    expect((listed?.data as { service_token?: string }).service_token).toBeUndefined()
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
    expect(['completed', 'failed']).toContain(job.state as string)
  }, 300_000)

  test('create schedule', async () => {
    const schedule = await client.jobs.createSchedule(wsId, {
      name: scoped('cron'),
      cron: '0 0 * * *',
      prompt: 'test scheduled job',
    })
    expect(schedule.name).toBe(scoped('cron'))
    scheduleId = schedule.id
  })

  test('list schedules contains created schedule', async () => {
    const schedules = await client.jobs.listSchedules(wsId)
    expect(schedules.some((s) => s.id === scheduleId)).toBe(true)
  })

  test('delete schedule', async () => {
    await client.jobs.deleteSchedule(wsId, scheduleId)
    const schedules = await client.jobs.listSchedules(wsId)
    expect(schedules.some((s) => s.id === scheduleId)).toBe(false)
  })
})
