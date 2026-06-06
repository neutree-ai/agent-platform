import { PgBoss } from 'pg-boss'
import { pool } from '../services/db/pool'

const QUEUE_NAME = 'agent-session'

let boss: PgBoss

export async function startJobQueue() {
  boss = new PgBoss({
    db: { executeSql: async (text: string, values?: unknown[]) => pool.query(text, values) },
  })

  boss.on('error', (err: Error) => console.error('[Jobs] pg-boss error:', err))

  await boss.start()

  // Create queue with defaults (idempotent)
  await boss
    .createQueue(QUEUE_NAME, {
      retryLimit: 0,
      expireInSeconds: 3600,
      retentionSeconds: 7 * 24 * 3600,
    })
    .catch(() => {})

  console.log('[Jobs] pg-boss started (send-only, worker runs in scheduler)')
}

export interface JobTrigger {
  type: string
  payload?: unknown
}

export interface JobData {
  workspace_id: string
  prompt: string
  trigger: JobTrigger
  service_token?: string
}

/** Send a job to the queue */
export async function sendJob(
  data: JobData,
  options?: { startAfter?: string | Date; retryLimit?: number; expireInSeconds?: number },
): Promise<string | null> {
  const opts: Record<string, unknown> = {
    retryLimit: options?.retryLimit ?? 0,
  }
  if (options?.startAfter) opts.startAfter = new Date(options.startAfter)
  if (options?.expireInSeconds) opts.expireInSeconds = options.expireInSeconds
  return boss.send(QUEUE_NAME, data, opts)
}

/** Create a cron schedule (key distinguishes schedules within the queue) */
async function scheduleJob(key: string, cron: string, data: JobData, tz?: string): Promise<void> {
  await boss.schedule(QUEUE_NAME, cron, data, { key, tz })
}

/** Remove a cron schedule */
async function unscheduleJob(key: string): Promise<void> {
  await boss.unschedule(QUEUE_NAME, key)
}

/** Cancel a queued (not yet started) job. No-op for jobs already active or
 *  completed — pg-boss silently ignores those states. */
async function cancelJob(id: string): Promise<void> {
  await boss.cancel(QUEUE_NAME, id)
}

// ── Schedule timer helpers ─────────────────────────────────────────────────
//
// Shared by the REST route and the Builder Mode action so both code paths
// register / cancel the pg-boss timer identically. Schedules are either
// recurring (cron, lives in pgboss.schedule keyed by `schedule-<id>`) or
// one-time (a single send with startAfter, identified by its returned job id).

const SCHEDULE_KEY = (id: string) => `schedule-${id}`

export async function enqueueScheduleTimer(schedule: {
  id: string
  workspace_id: string
  cron: string | null
  run_at: string | null
  timezone: string
}): Promise<string | null> {
  const payload: JobData = {
    workspace_id: schedule.workspace_id,
    prompt: '',
    trigger: { type: 'cron', payload: { schedule_id: schedule.id } },
  }
  if (schedule.cron) {
    await scheduleJob(SCHEDULE_KEY(schedule.id), schedule.cron, payload, schedule.timezone)
    return null
  }
  if (!schedule.run_at) {
    throw new Error(`schedule ${schedule.id} has neither cron nor run_at`)
  }
  return sendJob(payload, { startAfter: schedule.run_at })
}

export async function cancelScheduleTimer(schedule: {
  id: string
  cron: string | null
  pgboss_job_id: string | null
}): Promise<void> {
  if (schedule.cron) {
    await unscheduleJob(SCHEDULE_KEY(schedule.id))
    return
  }
  if (schedule.pgboss_job_id) {
    // Already executed / expired is fine — the DB row is the source of truth.
    await cancelJob(schedule.pgboss_job_id).catch(() => {})
  }
}

/** Get a job by ID */
export async function getJob(id: string) {
  return boss.getJobById(QUEUE_NAME, id)
}

/** Find the job that produced a given session (if any) */
export async function getJobBySessionId(sessionId: string) {
  const { rows } = await pool.query(
    `SELECT id, data, output, created_on, completed_on
     FROM pgboss.job
     WHERE name = $1 AND output->>'session_id' = $2
     LIMIT 1`,
    [QUEUE_NAME, sessionId],
  )
  return rows[0] ?? null
}

/** Fetch recent jobs for a workspace */
export async function listJobs(
  workspaceId: string,
  { limit = 50, offset = 0 }: { limit?: number; offset?: number } = {},
) {
  const { rows } = await pool.query(
    `SELECT id, name, data, state, output, retry_count,
            created_on, started_on, completed_on, expire_in
     FROM pgboss.job
     WHERE name = $1 AND data->>'workspace_id' = $2
     ORDER BY created_on DESC
     LIMIT $3 OFFSET $4`,
    [QUEUE_NAME, workspaceId, limit, offset],
  )
  return rows
}
