/**
 * skill-reload worker.
 *
 * cp enqueues one job per skill whose active content changed (publish / sync /
 * set-active). This worker performs the deferred fanout by calling back into
 * cp's `/_cp/skills/:id/reload-fanout`, which enumerates the dependent
 * workspaces and tells each agent to reload. Keeping the fanout in cp avoids
 * duplicating agent addressing + the workspace-skill query here.
 *
 * On any per-workspace failure cp reports `failed > 0`; we throw so pg-boss
 * retries the whole job (reload is idempotent + 304-cheap). Once retries are
 * exhausted the job is forwarded to the shared dead-letter queue.
 */
import type { JobWithMetadata, PgBoss } from 'pg-boss'
import { DEAD_LETTER_QUEUE } from './dead-letter'

const QUEUE_NAME = 'skill-reload'
const NAP_API_URL = process.env.NAP_API_URL || 'http://nap-cp:3000'

interface SkillReloadJob {
  kind: 'skill-reload'
  skillId: string
}

export async function registerSkillReloadWorker(boss: PgBoss): Promise<void> {
  // Mirror cp's queue config (createQueue is idempotent and won't update an
  // existing queue; cp's initSkillReloadQueue is the source of truth, this is
  // a defensive create in case the worker boots first).
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

  await boss.work<SkillReloadJob>(
    QUEUE_NAME,
    { localConcurrency: 5, includeMetadata: true },
    async (jobs: JobWithMetadata<SkillReloadJob>[]) => {
      for (const job of jobs) {
        const { skillId } = job.data
        const res = await fetch(`${NAP_API_URL}/_cp/skills/${skillId}/reload-fanout`, {
          method: 'POST',
        })
        if (!res.ok) {
          throw new Error(`reload-fanout skill=${skillId} returned ${res.status}`)
        }
        const { total, notified, failed } = (await res.json()) as {
          total: number
          notified: number
          failed: number
        }
        console.log(
          `[SkillReload] skill=${skillId} total=${total} notified=${notified} failed=${failed}`,
        )
        if (failed > 0) {
          // Throw to trigger pg-boss retry; the fanout is idempotent so already
          // notified workspaces just 304 on the next attempt.
          throw new Error(`reload-fanout skill=${skillId}: ${failed}/${total} workspaces failed`)
        }
      }
    },
  )

  console.log('[SkillReload] Worker registered')
}
