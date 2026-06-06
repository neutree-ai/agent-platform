import {
  BUILDER_KIND_SCHEDULE_CREATE,
  BUILDER_KIND_SCHEDULE_DELETE,
  BUILDER_KIND_SCHEDULE_UPDATE,
  ScheduleCreatePayloadSchema,
  ScheduleDeletePayloadSchema,
  ScheduleUpdatePayloadSchema,
} from '../../../../../../internal/types/builder'
import * as jobs from '../../../../lib/jobs'
import {
  createSchedule,
  deleteSchedule,
  getSchedule,
  updateSchedule,
} from '../../../../services/db/schedules'
import { defineBuilderAction } from '../define-action'

export const scheduleCreateAction = defineBuilderAction({
  kind: BUILDER_KIND_SCHEDULE_CREATE,
  resource: 'schedule',
  payload: ScheduleCreatePayloadSchema,
  label: 'Create schedule',
  proposeDescription:
    'Create a schedule on the current workspace. Either recurring (cron + timezone) or one-time (run_at as ISO 8601 instant in the future). See `__platform__:reference/builder-mode.md` for the propose/approve/apply contract.',
  apply: async ({ workspaceId, userId, payload }) => {
    if (payload.run_at && new Date(payload.run_at).getTime() <= Date.now()) {
      throw new Error('run_at must be in the future')
    }
    const schedule = await createSchedule({
      workspace_id: workspaceId,
      user_id: userId,
      name: payload.name,
      cron: payload.cron ?? null,
      run_at: payload.run_at ?? null,
      timezone: payload.timezone,
      prompt: payload.prompt ?? '',
      prompt_id: payload.prompt_id ?? null,
    })
    try {
      const pgbossJobId = await jobs.enqueueScheduleTimer(schedule)
      if (pgbossJobId) await updateSchedule(schedule.id, { pgboss_job_id: pgbossJobId })
    } catch (e: any) {
      await deleteSchedule(schedule.id)
      throw new Error(`failed to register schedule timer (${e.message})`)
    }
    return `Schedule "${schedule.name}" created (id=${schedule.id}).`
  },
})

export const scheduleUpdateAction = defineBuilderAction({
  kind: BUILDER_KIND_SCHEDULE_UPDATE,
  resource: 'schedule_update',
  payload: ScheduleUpdatePayloadSchema,
  label: 'Update schedule',
  proposeDescription:
    'Update an existing schedule. Only set the fields you want to change. Setting `cron` or `run_at` switches the schedule kind. See `__platform__:reference/builder-mode.md` for the contract.',
  apply: async ({ workspaceId, payload }) => {
    const existing = await getSchedule(payload.id)
    if (!existing || existing.workspace_id !== workspaceId) {
      throw new Error('schedule not found in this workspace')
    }
    if (existing.completed_at) {
      throw new Error('cannot edit a completed one-time schedule')
    }
    if (existing.origin === 'template') {
      const changesDefinition =
        payload.name !== undefined ||
        payload.cron !== undefined ||
        payload.run_at !== undefined ||
        payload.timezone !== undefined ||
        payload.prompt !== undefined ||
        payload.prompt_id !== undefined
      if (changesDefinition) {
        throw new Error(
          `"${existing.name}" is a template-provided schedule and is read-only except enable/disable. Fork it to customize.`,
        )
      }
    }
    if (payload.run_at && new Date(payload.run_at).getTime() <= Date.now()) {
      throw new Error('run_at must be in the future')
    }
    const patch: Record<string, unknown> = {}
    if (payload.name !== undefined) patch.name = payload.name
    if (payload.timezone !== undefined) patch.timezone = payload.timezone
    if (payload.enabled !== undefined) patch.enabled = payload.enabled
    // Switching kind: clear the opposite column so the DB CHECK
    // (cron XOR run_at) holds.
    if (payload.cron !== undefined) {
      patch.cron = payload.cron
      patch.run_at = null
    } else if (payload.run_at !== undefined) {
      patch.run_at = payload.run_at
      patch.cron = null
    }
    if (payload.prompt !== undefined) {
      patch.prompt = payload.prompt
      patch.prompt_id = null
    } else if (payload.prompt_id !== undefined) {
      patch.prompt_id = payload.prompt_id || null
      patch.prompt = ''
    }
    const updated = await updateSchedule(payload.id, patch)
    if (!updated) throw new Error('schedule disappeared during update')

    const timerChanged =
      payload.cron !== undefined ||
      payload.run_at !== undefined ||
      payload.timezone !== undefined ||
      payload.enabled !== undefined
    if (timerChanged) {
      await jobs.cancelScheduleTimer(existing)
      if (updated.enabled !== false) {
        const pgbossJobId = await jobs.enqueueScheduleTimer(updated)
        if (pgbossJobId !== updated.pgboss_job_id) {
          await updateSchedule(updated.id, { pgboss_job_id: pgbossJobId })
        }
      } else if (existing.pgboss_job_id) {
        await updateSchedule(updated.id, { pgboss_job_id: null })
      }
    }
    return `Schedule "${updated.name}" updated (id=${updated.id}).`
  },
})

export const scheduleDeleteAction = defineBuilderAction({
  kind: BUILDER_KIND_SCHEDULE_DELETE,
  resource: 'schedule_delete',
  payload: ScheduleDeletePayloadSchema,
  label: 'Delete schedule',
  proposeDescription:
    'Delete a schedule. See `__platform__:reference/builder-mode.md` for the contract.',
  apply: async ({ workspaceId, payload }) => {
    const existing = await getSchedule(payload.id)
    if (!existing || existing.workspace_id !== workspaceId) {
      throw new Error('schedule not found in this workspace')
    }
    if (existing.origin === 'template') {
      throw new Error(
        `"${existing.name}" is a template-provided schedule and cannot be deleted. Disable it instead.`,
      )
    }
    await jobs.cancelScheduleTimer(existing)
    await deleteSchedule(existing.id)
    return `Schedule "${existing.name}" deleted (id=${existing.id}).`
  },
})
