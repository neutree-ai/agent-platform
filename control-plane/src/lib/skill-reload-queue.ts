/**
 * skill-reload queue (send-only; worker runs in scheduler).
 *
 * When a skill's active content changes (publish / sync / set-active), every
 * workspace mounting it must reload. That fanout used to run inline on the
 * write request — the user waited for the slowest dependent agent's full
 * reload RTT. Here we instead enqueue a single job keyed by skillId; the
 * scheduler worker calls back into cp's `/_cp/skills/:id/reload-fanout` to do
 * the actual fanout, so the write returns as soon as the enqueue commits.
 *
 * Coalescing: `singletonKey: skillId` collapses a burst of publishes of the
 * same skill into one queued job. Safe because the fanout reads the *current*
 * active version at execution time — a coalesced second publish still lands.
 *
 * Exhaustion: retries ride out a transient agent (starting / mid-turn). Once
 * retryLimit is exhausted the job is forwarded to the shared `dead-letter`
 * queue (see scheduler dead-letter worker) so the failure is surfaced, not
 * silently dropped. Affected workspaces self-heal on their next reload trigger
 * (next publish/sync, or container restart pre-sweep).
 */
import { PgBoss } from 'pg-boss'
import type { ReloadEnqueuer } from '../services/agent-notifier'
import { pool } from '../services/db/pool'
import { DEAD_LETTER_QUEUE, ensureDeadLetterQueue } from './dead-letter'

const QUEUE_NAME = 'skill-reload'

interface SkillReloadJob {
  kind: 'skill-reload'
  skillId: string
}

let boss: PgBoss

/** Initialize the skill-reload queue (send-only, worker runs in scheduler). */
export async function initSkillReloadQueue() {
  boss = new PgBoss({
    db: { executeSql: async (text: string, values?: unknown[]) => pool.query(text, values) },
  })

  boss.on('error', (err: Error) => console.error('[SkillReload] pg-boss error:', err))

  await boss.start()

  // Must exist before skill-reload references it as its dead_letter (FK).
  await ensureDeadLetterQueue(boss)

  await boss
    .createQueue(QUEUE_NAME, {
      retryLimit: 3,
      retryDelay: 15,
      retryBackoff: true,
      expireInSeconds: 120,
      retentionSeconds: 7 * 24 * 3600,
      deadLetter: DEAD_LETTER_QUEUE,
    })
    .catch(() => {})

  console.log('[SkillReload] Queue initialized (send-only, worker runs in scheduler)')
}

/** Enqueue a reload fanout for a skill. Coalesced per skillId. */
async function enqueueSkillReload(skillId: string): Promise<void> {
  const job: SkillReloadJob = { kind: 'skill-reload', skillId }
  await boss.send(QUEUE_NAME, job, { singletonKey: skillId })
}

/** Production ReloadEnqueuer backed by the pg-boss queue. */
export class QueueReloadEnqueuer implements ReloadEnqueuer {
  enqueue(skillId: string): Promise<void> {
    return enqueueSkillReload(skillId)
  }
}
