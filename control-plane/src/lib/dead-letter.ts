/**
 * Shared dead-letter queue name + creation helper.
 *
 * One queue catches the failed-and-exhausted jobs from every business queue
 * that opts in via `deadLetter: DEAD_LETTER_QUEUE`. pg-boss enforces a foreign
 * key (`job.dead_letter REFERENCES queue(name)`), so the DLQ must exist before
 * any queue can reference it. Both cp (which references it) and the scheduler
 * (which works it) call `ensureDeadLetterQueue` — createQueue is idempotent.
 *
 * The DLQ worker lives in the scheduler; see scheduler/src/dead-letter.ts.
 */
import type { PgBoss } from 'pg-boss'

export const DEAD_LETTER_QUEUE = 'dead-letter'

/** Idempotently create the shared dead-letter queue. */
export async function ensureDeadLetterQueue(boss: PgBoss): Promise<void> {
  await boss
    .createQueue(DEAD_LETTER_QUEUE, {
      // The DLQ is a terminal sink: no further retries, just retain for a week
      // so the failure can be inspected before deletion.
      retryLimit: 0,
      retentionSeconds: 7 * 24 * 3600,
    })
    .catch(() => {})
}
