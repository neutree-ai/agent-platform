import { type JobWithMetadata, PgBoss } from 'pg-boss'
import { registerAdminStatsRefreshWorker } from './admin-stats-refresh'
import {
  cleanupOldEventLogs,
  cleanupOldThreadSessions,
  cleanupOrphanedWsSlots,
  cleanupStaleWsSlots,
  pool,
} from './db'
import { registerDeadLetterWorker } from './dead-letter'
import { type JobData, handleJob } from './handler'
import { registerNotificationWorker } from './notifications'
import { registerSkillReloadWorker } from './skill-reload'
import { registerTitleGenWorker } from './title-gen'

process.on('uncaughtException', (err) => {
  console.error('[fatal] Uncaught exception (process kept alive):', err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[fatal] Unhandled rejection (process kept alive):', reason)
})

const QUEUE_NAME = 'agent-session'

const boss = new PgBoss({
  db: { executeSql: async (text: string, values?: unknown[]) => pool.query(text, values) },
})

boss.on('error', (err: Error) => console.error('[Scheduler] pg-boss error:', err))

await boss.start()

// Create queue with defaults (idempotent — createQueue won't update existing config)
const queueOptions = {
  retryLimit: 0,
  // Backstop for a job stuck active outside runTurn (e.g. a sendReply fetch
  // with no timeout). Kept large on purpose: lowering it risks failing jobs
  // that are legitimately busy-waiting for a ws concurrency slot.
  expireInSeconds: 12 * 3600,
  retentionSeconds: 7 * 24 * 3600,
  // When the scheduler process dies mid-job, its jobs are stranded in 'active'.
  // The worker auto-sends heartbeats every heartbeatSeconds/2 while alive; once
  // they stop, the monitor fails the job within ~heartbeatSeconds — which lets
  // cleanupOrphanedWsSlots reclaim the job's ws slot instead of waiting 12h.
  // Does NOT catch a hung-but-alive handler (heartbeat keeps firing) — that is
  // runTurn's idle timeout's job.
  heartbeatSeconds: 120,
}
await boss.createQueue(QUEUE_NAME, queueOptions).catch(() => {})
// Ensure config is up-to-date for existing queues
await boss.updateQueue(QUEUE_NAME, queueOptions)

// Clean up stale concurrency slots from previous crashes
const cleaned = await cleanupStaleWsSlots()
if (cleaned > 0) console.log(`[Scheduler] Cleaned up ${cleaned} stale concurrency slots`)

// Periodically reclaim leaked ws concurrency slots. Two complementary sweeps:
//   - orphaned: job is no longer created/active/retry (covers fast-failed jobs,
//     including pod-death orphans once heartbeatSeconds lets the monitor fail
//     them — see queueOptions above)
//   - stale: claimed_at older than the threshold regardless of job state — the
//     backstop for a slot leaked while its job is still 'active'
const SLOT_CLEANUP_INTERVAL = 60_000 // every 60 seconds
setInterval(async () => {
  try {
    const orphaned = await cleanupOrphanedWsSlots()
    const stale = await cleanupStaleWsSlots()
    if (orphaned > 0 || stale > 0) {
      console.log(`[Scheduler] Reclaimed concurrency slots: ${orphaned} orphaned, ${stale} stale`)
    }
  } catch (e) {
    console.error('[Scheduler] Slot cleanup error:', e)
  }
}, SLOT_CLEANUP_INTERVAL)

// Clean up old event logs and stale thread sessions (every 6 hours)
const EVENT_CLEANUP_INTERVAL = 6 * 60 * 60_000
setInterval(async () => {
  try {
    const events = await cleanupOldEventLogs(30)
    const sessions = await cleanupOldThreadSessions(7)
    if (events > 0 || sessions > 0) {
      console.log(
        `[Scheduler] Cleaned up ${events} old event logs, ${sessions} stale thread sessions`,
      )
    }
  } catch (e) {
    console.error('[Scheduler] Event log cleanup error:', e)
  }
}, EVENT_CLEANUP_INTERVAL)

console.log('[Scheduler] pg-boss started')

// Register the handler
await boss.work<JobData>(
  QUEUE_NAME,
  { localConcurrency: 30, includeMetadata: true },
  async (jobs: JobWithMetadata<JobData>[]) => {
    for (const job of jobs) {
      await handleJob(job)
    }
  },
)

// Register notification delivery worker
await registerNotificationWorker(boss)

// Register the shared dead-letter sink + the skill-reload fanout worker.
await registerDeadLetterWorker(boss)
await registerSkillReloadWorker(boss)

// Register the session title-generation cron worker.
await registerTitleGenWorker(boss)

// Register the admin dashboard stats-refresh cron worker.
await registerAdminStatsRefreshWorker(boss)

console.log('[Scheduler] Worker registered, waiting for jobs...')

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('[Scheduler] Shutting down...')
  await boss.stop({ graceful: true })
  await pool.end()
  process.exit(0)
})
