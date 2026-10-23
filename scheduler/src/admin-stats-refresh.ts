/** Periodic stats updates and a nightly rebuild to repair deletion/late-commit drift. */
import type { PgBoss } from 'pg-boss'
import { refreshAdminStats } from './admin-stats-db'

const QUEUE_NAME = 'admin-stats-refresh'
const REBUILD_QUEUE_NAME = 'admin-stats-rebuild'

export async function registerAdminStatsRefreshWorker(boss: PgBoss): Promise<void> {
  const refreshCron = process.env.ADMIN_STATS_REFRESH_CRON || '*/10 * * * *'
  const rebuildCron = process.env.ADMIN_STATS_REBUILD_CRON || '0 3 * * *'
  if (process.env.DISABLE_ADMIN_STATS_REFRESH === '1') {
    await boss.unschedule(QUEUE_NAME).catch(() => {})
    await boss.unschedule(REBUILD_QUEUE_NAME).catch(() => {})
    console.log('[AdminStatsRefresh] Disabled (DISABLE_ADMIN_STATS_REFRESH=1)')
    return
  }

  for (const [name, cron, fullRebuild] of [
    [QUEUE_NAME, refreshCron, false],
    [REBUILD_QUEUE_NAME, rebuildCron, true],
  ] as const) {
    const queueOptions = {
      // One queued or active job per queue prevents a backlog of redundant ticks.
      policy: 'stately' as const,
      retryLimit: 0,
      // A rebuild rescans the whole ledger and message history.
      expireInSeconds: fullRebuild ? 2 * 3600 : 5 * 60,
      retentionSeconds: 24 * 3600,
    }
    await boss.createQueue(name, queueOptions).catch(() => {})
    await boss.updateQueue(name, queueOptions).catch(() => {})
    await boss.schedule(name, cron, {}, { tz: 'UTC' })
    await boss.work(name, async () => {
      try {
        await refreshAdminStats(fullRebuild)
      } catch (e) {
        console.error(`[AdminStatsRefresh] ${name} failed:`, e instanceof Error ? e.message : e)
      }
    })
    console.log(`[AdminStatsRefresh] Worker registered (${name}, cron ${cron} UTC)`)
  }

  // Initialize missing watermark state as soon as this scheduler starts.
  await boss.send(QUEUE_NAME, {})
}
