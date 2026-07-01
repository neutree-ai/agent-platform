/**
 * Session title generation worker.
 *
 * A pg-boss cron schedule fires once per tick cluster-wide (the pgboss clock
 * holds a singleton lock), so exactly one scheduler instance enqueues + runs
 * each sweep — unlike a per-replica setInterval, this never fans the paid LLM
 * calls out N times. The queue's singleton policy also prevents a slow sweep
 * from overlapping the next tick.
 *
 * Each sweep titles active sessions that still have an empty name using the LLM
 * configured in system_settings.titlegen_* (managed from the admin UI). Whether
 * it does anything is driven entirely by that config: an unconfigured or invalid
 * config resolves to no provider and the sweep is a no-op. DISABLE_SESSION_TITLEGEN=1
 * is a hard kill-switch that also unschedules any previously-registered cron.
 */
import type { PgBoss } from 'pg-boss'
import { generateTitle, resolveTitleGenProvider } from '../../internal/titlegen/src'
import { getTitleGenCandidates, getTitleGenSettings, setSessionTitleIfEmpty } from './db'

const QUEUE_NAME = 'session-titlegen'

// Cron + batch are env-overridable so the temporary backlog drain (fast/large)
// can be dialed back to steady state without a rebuild — just change the env on
// the scheduler deployment and restart. pg-boss cron granularity is 1 minute
// (sub-minute is not honored by its clock), so '*/1 * * * *' is the floor.
const SWEEP_CRON = process.env.TITLEGEN_CRON || '*/1 * * * *'

// Env-overridable integer knob with a positive-default fallback.
function intEnv(name: string, fallback: number): number {
  const n = Number(process.env[name])
  return Number.isInteger(n) && n > 0 ? n : fallback
}

// How many untitled sessions to title per sweep. Bounds LLM fan-out and
// wall-clock; the next tick picks up the remainder.
const BATCH_SIZE = intEnv('TITLEGEN_BATCH_SIZE', 30)

// How many titles to generate concurrently within a sweep. Titles are cheap and
// independent; a small pool cuts sweep wall-clock without hammering the provider.
const CONCURRENCY = intEnv('TITLEGEN_CONCURRENCY', 3)

// Only title sessions quiet for this long, so we don't race an in-flight first
// turn and title a half-finished exchange.
const QUIET_SECONDS = 30

// Run `worker` over `items` with at most `concurrency` in flight at once.
async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]
      await worker(item)
    }
  })
  await Promise.all(runners)
}

async function sweepSessionTitles(): Promise<void> {
  const { activeProvider, providers } = await getTitleGenSettings()
  const provider = resolveTitleGenProvider(activeProvider, providers)
  if (!provider) return // feature not configured — no-op

  const candidates = await getTitleGenCandidates(BATCH_SIZE, QUIET_SECONDS)
  await runPool(candidates, CONCURRENCY, async (row) => {
    if (!row.first_user_message.trim()) return
    try {
      const title = await generateTitle(provider, row.first_user_message)
      if (!title) return
      // Write guarded by name='' — idempotent against a concurrent user rename.
      await setSessionTitleIfEmpty(row.id, title)
    } catch (e) {
      console.error(`[TitleGen] failed for session=${row.id}:`, e instanceof Error ? e.message : e)
    }
  })
}

export async function registerTitleGenWorker(boss: PgBoss): Promise<void> {
  if (process.env.DISABLE_SESSION_TITLEGEN === '1') {
    // Kill-switch: stop the cron from firing if it was registered by a prior boot.
    await boss.unschedule(QUEUE_NAME).catch(() => {})
    console.log('[TitleGen] Disabled (DISABLE_SESSION_TITLEGEN=1)')
    return
  }

  const queueOptions = {
    // 'stately': at most one job in created OR active at a time. While a sweep
    // is queued or running, the next cron tick's send is dropped (skipped)
    // rather than piling up — no backlog of redundant sweep jobs.
    policy: 'stately' as const,
    // A failed or skipped sweep just waits for the next tick; no retry needed.
    retryLimit: 0,
    expireInSeconds: 5 * 60,
    retentionSeconds: 24 * 3600,
  }
  // createQueue no-ops on an existing queue, so updateQueue is needed to apply
  // config changes (e.g. the policy switch) to a queue created by a prior boot.
  await boss.createQueue(QUEUE_NAME, queueOptions).catch(() => {})
  await boss.updateQueue(QUEUE_NAME, queueOptions).catch(() => {})

  // Idempotent upsert keyed by queue name; re-registering on each boot is safe.
  await boss.schedule(QUEUE_NAME, SWEEP_CRON)

  await boss.work(QUEUE_NAME, async () => {
    await sweepSessionTitles()
  })

  console.log(
    `[TitleGen] Worker registered (cron ${SWEEP_CRON}, batch ${BATCH_SIZE}, concurrency ${CONCURRENCY})`,
  )
}
