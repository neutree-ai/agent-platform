/**
 * Shared dead-letter queue + worker.
 *
 * Every business queue that opts in via `deadLetter: DEAD_LETTER_QUEUE` (e.g.
 * skill-reload) forwards its failed-and-retry-exhausted jobs here. pg-boss
 * copies the original `data` (payload) and `output` (last error) into a new
 * job on this queue; the original queue name is NOT preserved, so payloads
 * carry a `kind` discriminator for attribution.
 *
 * This worker is a terminal sink: it does not retry or re-dispatch. It just
 * makes the exhaustion loud (structured error log) instead of leaving a silent
 * `failed` row no one inspects. The dead-letter row itself is retained
 * (retentionSeconds) for post-hoc inspection.
 */
import type { JobWithMetadata, PgBoss } from 'pg-boss'

export const DEAD_LETTER_QUEUE = 'dead-letter'

/** Idempotently create the shared dead-letter queue. */
async function ensureDeadLetterQueue(boss: PgBoss): Promise<void> {
  await boss
    .createQueue(DEAD_LETTER_QUEUE, {
      retryLimit: 0,
      retentionSeconds: 7 * 24 * 3600,
    })
    .catch(() => {})
}

interface DeadLetterPayload {
  kind?: string
  [key: string]: unknown
}

export async function registerDeadLetterWorker(boss: PgBoss): Promise<void> {
  await ensureDeadLetterQueue(boss)

  await boss.work<DeadLetterPayload>(
    DEAD_LETTER_QUEUE,
    { localConcurrency: 1, includeMetadata: true },
    async (jobs: JobWithMetadata<DeadLetterPayload>[]) => {
      for (const job of jobs) {
        const { kind, ...payload } = job.data ?? {}
        console.error(
          `[DLQ] job exhausted kind=${kind ?? 'unknown'} dlq_id=${job.id}`,
          JSON.stringify({ payload, error: job.output }),
        )
      }
    },
  )

  console.log('[DLQ] Dead-letter worker registered')
}
