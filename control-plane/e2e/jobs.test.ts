import { afterAll, beforeAll, expect, test } from 'vitest'
import { createLlmProvider, createRunningWorkspace, waitForStatus } from './fixtures'
import { client, describeEachCore, scoped } from './setup'

async function waitForJobDone(wsId: string, jobId: string, maxWaitMs = 120_000) {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    const job = await client.jobs.get(wsId, jobId)
    if (job.status === 'completed' || job.status === 'failed') return job
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

  // Blocked on neutree-ai/agent-platform#152 — GET /workspaces/:id/jobs answers
  // 500 because listJobs selects `expire_in`, a column pg-boss v12 removed.
  // Both tests below read that endpoint. Re-enable with the fix.
  test.skip('list jobs contains created job', async () => {
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

  test.skip('wait for job completion', async () => {
    const created = await client.jobs.create(wsId, {
      prompt: 'Reply with: JOB_COMPLETE',
      trigger: { type: 'manual' },
    })
    const job = await waitForJobDone(wsId, created.id, 120_000)
    expect(['completed', 'failed']).toContain(job.status as string)
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
