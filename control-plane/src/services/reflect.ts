import * as jobs from '../lib/jobs'
import { setStoreReflectSchedule } from './db/memory'
import { createSchedule, updateSchedule } from './db/schedules'
import { REFLECT_PROMPT } from './reflect-prompt'

/** Default cadence for an auto-created Reflect schedule: weekly. */
const DEFAULT_REFLECT_CRON = '0 3 * * 0'

/**
 * Create the builtin Reflect schedule for a workspace's own memory store and
 * link the store back to it (memory_stores.reflect_schedule_id). The link
 * lives on the store, not on `schedules` — `schedules` stays a generic
 * "cron/one-shot -> workspace chat" primitive shared with template and
 * user-created schedules, with no awareness of Reflect.
 *
 * Mirrors `materializeOne` in template-schedules.ts: on pg-boss registration
 * failure, leave the row but flip it disabled rather than claim it's active.
 * Never throws — a Reflect bootstrap failure should not fail workspace
 * creation, matching the caller's existing try/catch around the store
 * auto-provision this sits next to.
 */
export async function createReflectSchedule(args: {
  workspaceId: string
  userId: string
  storeId: string
}): Promise<void> {
  const schedule = await createSchedule({
    workspace_id: args.workspaceId,
    user_id: args.userId,
    name: 'Memory Reflect',
    cron: DEFAULT_REFLECT_CRON,
    run_at: null,
    timezone: 'UTC',
    prompt: REFLECT_PROMPT,
    prompt_id: null,
    origin: 'local',
    enabled: true,
  })
  await setStoreReflectSchedule(args.storeId, schedule.id)
  try {
    const pgbossJobId = await jobs.enqueueScheduleTimer(schedule)
    if (pgbossJobId) await updateSchedule(schedule.id, { pgboss_job_id: pgbossJobId })
  } catch {
    await updateSchedule(schedule.id, { enabled: false, pgboss_job_id: null })
  }
}
