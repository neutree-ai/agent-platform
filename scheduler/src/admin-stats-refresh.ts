/**
 * Admin dashboard stats refresh worker.
 *
 * The admin dashboard reads from a handful of materialized views (interaction
 * and token aggregates). Control-plane refreshes them lazily on request, but
 * throttled to at most once per 10 minutes per cp process and fire-and-forget —
 * so with no admin traffic the views can drift arbitrarily stale, and the
 * request that triggers a refresh still sees the pre-refresh data.
 *
 * This worker makes the refresh unconditional: a pg-boss cron fires once per
 * tick cluster-wide (the pgboss clock holds a singleton lock), so exactly one
 * scheduler instance refreshes each tick — no per-replica fan-out. The queue's
 * 'stately' policy drops a tick whose predecessor is still running, so a slow
 * refresh never stacks. The cp on-demand path stays as-is; the two coexist.
 *
 * DISABLE_ADMIN_STATS_REFRESH=1 is a hard kill-switch that also unschedules any
 * previously-registered cron.
 */
import type { PgBoss } from 'pg-boss'
import { refreshAdminMatviews } from './db'

const QUEUE_NAME = 'admin-stats-refresh'

// Env-overridable so the cadence can be tuned without a rebuild. pg-boss cron
// granularity is 1 minute (sub-minute is not honored by its clock). Default
// every 10 minutes, matching cp's on-demand throttle window.
const REFRESH_CRON = process.env.ADMIN_STATS_REFRESH_CRON || '*/10 * * * *'

export async function registerAdminStatsRefreshWorker(boss: PgBoss): Promise<void> {
  if (process.env.DISABLE_ADMIN_STATS_REFRESH === '1') {
    // Kill-switch: stop the cron from firing if it was registered by a prior boot.
    await boss.unschedule(QUEUE_NAME).catch(() => {})
    console.log('[AdminStatsRefresh] Disabled (DISABLE_ADMIN_STATS_REFRESH=1)')
    return
  }

  const queueOptions = {
    // 'stately': at most one job in created OR active at a time. While a refresh
    // is queued or running, the next cron tick's send is dropped rather than
    // piling up — no backlog of redundant refresh jobs.
    policy: 'stately' as const,
    // A failed or skipped refresh just waits for the next tick; no retry needed.
    retryLimit: 0,
    // REFRESH CONCURRENTLY on all views should finish well within this; the
    // backstop only matters if a refresh wedges.
    expireInSeconds: 5 * 60,
    retentionSeconds: 24 * 3600,
  }
  // createQueue no-ops on an existing queue, so updateQueue applies config
  // changes (e.g. the policy) to a queue created by a prior boot.
  await boss.createQueue(QUEUE_NAME, queueOptions).catch(() => {})
  await boss.updateQueue(QUEUE_NAME, queueOptions).catch(() => {})

  // Idempotent upsert keyed by queue name; re-registering on each boot is safe.
  await boss.schedule(QUEUE_NAME, REFRESH_CRON)

  await boss.work(QUEUE_NAME, async () => {
    try {
      await refreshAdminMatviews()
    } catch (e) {
      console.error('[AdminStatsRefresh] refresh failed:', e instanceof Error ? e.message : e)
    }
  })

  console.log(`[AdminStatsRefresh] Worker registered (cron ${REFRESH_CRON})`)
}
