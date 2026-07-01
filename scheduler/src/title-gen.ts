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
const SWEEP_CRON = '*/5 * * * *' // every 5 minutes

// How many untitled sessions to title per sweep. Bounds LLM fan-out and
// wall-clock; the next tick picks up the remainder.
const BATCH_SIZE = 10

// Only title sessions quiet for this long, so we don't race an in-flight first
// turn and title a half-finished exchange.
const QUIET_SECONDS = 30

async function sweepSessionTitles(): Promise<void> {
  const { activeProvider, providers } = await getTitleGenSettings()
  const provider = resolveTitleGenProvider(activeProvider, providers)
  if (!provider) return // feature not configured — no-op

  const candidates = await getTitleGenCandidates(BATCH_SIZE, QUIET_SECONDS)
  for (const row of candidates) {
    if (!row.first_user_message.trim()) continue
    try {
      const title = await generateTitle(provider, row.first_user_message)
      if (!title) continue
      // Write guarded by name='' — idempotent against a concurrent user rename.
      await setSessionTitleIfEmpty(row.id, title)
    } catch (e) {
      console.error(`[TitleGen] failed for session=${row.id}:`, e instanceof Error ? e.message : e)
    }
  }
}

export async function registerTitleGenWorker(boss: PgBoss): Promise<void> {
  if (process.env.DISABLE_SESSION_TITLEGEN === '1') {
    // Kill-switch: stop the cron from firing if it was registered by a prior boot.
    await boss.unschedule(QUEUE_NAME).catch(() => {})
    console.log('[TitleGen] Disabled (DISABLE_SESSION_TITLEGEN=1)')
    return
  }

  await boss
    .createQueue(QUEUE_NAME, {
      // Only one sweep active at a time — a slow sweep never overlaps the next tick.
      policy: 'singleton',
      // A failed or skipped sweep just waits for the next tick; no retry needed.
      retryLimit: 0,
      expireInSeconds: 5 * 60,
      retentionSeconds: 24 * 3600,
    })
    .catch(() => {})

  // Idempotent upsert keyed by queue name; re-registering on each boot is safe.
  await boss.schedule(QUEUE_NAME, SWEEP_CRON)

  await boss.work(QUEUE_NAME, async () => {
    await sweepSessionTitles()
  })

  console.log('[TitleGen] Worker registered (cron */5m)')
}
