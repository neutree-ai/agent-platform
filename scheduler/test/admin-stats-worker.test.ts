import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import type { PgBoss } from 'pg-boss'
import { registerAdminStatsRefreshWorker } from '../src/admin-stats-refresh'

const originalEnv = { ...process.env }
afterEach(() => {
  for (const name of [
    'ADMIN_STATS_REFRESH_CRON',
    'ADMIN_STATS_REBUILD_CRON',
    'DISABLE_ADMIN_STATS_REFRESH',
  ]) {
    if (originalEnv[name] === undefined) Reflect.deleteProperty(process.env, name)
    else process.env[name] = originalEnv[name]
  }
})

function queueStub() {
  const schedules: unknown[][] = []
  const unscheduled: string[] = []
  const workers: string[] = []
  const sent: string[] = []
  const boss = {
    createQueue: async () => {},
    updateQueue: async () => {},
    schedule: async (...args: unknown[]) => {
      schedules.push(args)
    },
    unschedule: async (name: string) => {
      unscheduled.push(name)
    },
    work: async (name: string) => {
      workers.push(name)
    },
    send: async (name: string) => {
      sent.push(name)
    },
  } as unknown as PgBoss
  return { boss, schedules, unscheduled, workers, sent }
}

test('registers UTC refresh/rebuild jobs and immediately queues initialization', async () => {
  process.env.DISABLE_ADMIN_STATS_REFRESH = ''
  process.env.ADMIN_STATS_REFRESH_CRON = ''
  process.env.ADMIN_STATS_REBUILD_CRON = ''
  const queue = queueStub()
  await registerAdminStatsRefreshWorker(queue.boss)
  assert.deepEqual(queue.schedules, [
    ['admin-stats-refresh', '*/10 * * * *', {}, { tz: 'UTC' }],
    ['admin-stats-rebuild', '0 3 * * *', {}, { tz: 'UTC' }],
  ])
  assert.deepEqual(queue.workers, ['admin-stats-refresh', 'admin-stats-rebuild'])
  assert.deepEqual(queue.sent, ['admin-stats-refresh'])
})

test('honors both cron overrides', async () => {
  process.env.DISABLE_ADMIN_STATS_REFRESH = ''
  process.env.ADMIN_STATS_REFRESH_CRON = '*/5 * * * *'
  process.env.ADMIN_STATS_REBUILD_CRON = '0 4 * * *'
  const queue = queueStub()
  await registerAdminStatsRefreshWorker(queue.boss)
  assert.equal(queue.schedules[0][1], '*/5 * * * *')
  assert.equal(queue.schedules[1][1], '0 4 * * *')
})

test('the kill switch unschedules both jobs and skips startup work', async () => {
  process.env.DISABLE_ADMIN_STATS_REFRESH = '1'
  const queue = queueStub()
  await registerAdminStatsRefreshWorker(queue.boss)
  assert.deepEqual(queue.unscheduled, ['admin-stats-refresh', 'admin-stats-rebuild'])
  assert.deepEqual(queue.schedules, [])
  assert.deepEqual(queue.workers, [])
  assert.deepEqual(queue.sent, [])
})
