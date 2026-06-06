import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  ApiScheduleSchema,
  ScheduleCreateBodySchema,
  ScheduleUpdateBodySchema,
} from '../../../../internal/types/api'
import * as jobs from '../../lib/jobs'
import type { AppEnv } from '../../lib/types'
import {
  createSchedule,
  deleteSchedule,
  getSchedule,
  listSchedulesByWorkspace,
  updateSchedule,
} from '../../services/db/schedules'
import { getWorkspace } from '../../services/db/workspaces'

const schedules = new OpenAPIHono<AppEnv>()

const ErrorSchema = z.object({ error: z.string() })
const SuccessSchema = z.object({ success: z.boolean() })

const WorkspaceIdParam = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' } }),
})

const ScheduleParam = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' } }),
  scheduleId: z.string().openapi({ param: { name: 'scheduleId', in: 'path' } }),
})

// ── POST /:id/schedules ────────────────────────────────────────────────────
const createRouteDef = createRoute({
  method: 'post',
  path: '/{id}/schedules',
  tags: ['workspaces'],
  summary:
    'Create a schedule. Recurring (cron) or one-time (run_at); registers a pg-boss timer and rolls back the DB row on failure.',
  security: [{ bearerAuth: [] }],
  request: {
    params: WorkspaceIdParam,
    body: { content: { 'application/json': { schema: ScheduleCreateBodySchema } } },
  },
  responses: {
    201: {
      description: 'Created schedule',
      content: { 'application/json': { schema: z.object({ schedule: ApiScheduleSchema }) } },
    },
    400: { description: 'Invalid input', content: { 'application/json': { schema: ErrorSchema } } },
    404: {
      description: 'Workspace not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

schedules.openapi(createRouteDef, async (c) => {
  const currentUser = c.get('user')
  const { id } = c.req.valid('param')

  const workspace = await getWorkspace(id)
  if (!workspace || workspace.user_id !== currentUser.sub) {
    return c.json({ error: 'Workspace not found' }, 404)
  }

  const body = c.req.valid('json')
  if (!body.prompt && !body.prompt_id) {
    return c.json({ error: 'prompt or prompt_id is required' }, 400)
  }
  if (body.run_at && new Date(body.run_at).getTime() <= Date.now()) {
    return c.json({ error: 'run_at must be in the future' }, 400)
  }

  const schedule = await createSchedule({
    workspace_id: id,
    user_id: currentUser.sub,
    name: body.name,
    cron: body.cron ?? null,
    run_at: body.run_at ?? null,
    timezone: body.timezone,
    prompt: body.prompt ?? '',
    prompt_id: body.prompt_id,
  })

  try {
    const pgbossJobId = await jobs.enqueueScheduleTimer(schedule)
    if (pgbossJobId) {
      const updated = await updateSchedule(schedule.id, { pgboss_job_id: pgbossJobId })
      return c.json({ schedule: updated ?? schedule }, 201)
    }
  } catch (e) {
    await deleteSchedule(schedule.id)
    throw e
  }

  return c.json({ schedule }, 201)
})

// ── GET /:id/schedules ─────────────────────────────────────────────────────
const listRoute = createRoute({
  method: 'get',
  path: '/{id}/schedules',
  tags: ['workspaces'],
  summary: 'List schedules for a workspace',
  security: [{ bearerAuth: [] }],
  request: { params: WorkspaceIdParam },
  responses: {
    200: {
      description: 'Schedule list',
      content: {
        'application/json': { schema: z.object({ schedules: z.array(ApiScheduleSchema) }) },
      },
    },
    404: {
      description: 'Workspace not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

schedules.openapi(listRoute, async (c) => {
  const currentUser = c.get('user')
  const { id } = c.req.valid('param')

  const workspace = await getWorkspace(id)
  if (!workspace || workspace.user_id !== currentUser.sub) {
    return c.json({ error: 'Workspace not found' }, 404)
  }

  const list = await listSchedulesByWorkspace(id)
  return c.json({ schedules: list }, 200)
})

// ── PATCH /:id/schedules/:scheduleId ───────────────────────────────────────
const patchRoute = createRoute({
  method: 'patch',
  path: '/{id}/schedules/{scheduleId}',
  tags: ['workspaces'],
  summary:
    'Update a schedule. Re-registers the pg-boss timer when cron / run_at / timezone / enabled change.',
  security: [{ bearerAuth: [] }],
  request: {
    params: ScheduleParam,
    body: { content: { 'application/json': { schema: ScheduleUpdateBodySchema } } },
  },
  responses: {
    200: {
      description: 'Updated schedule',
      content: { 'application/json': { schema: z.object({ schedule: ApiScheduleSchema }) } },
    },
    400: { description: 'Invalid input', content: { 'application/json': { schema: ErrorSchema } } },
    404: {
      description: 'Workspace or schedule not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

schedules.openapi(patchRoute, async (c) => {
  const currentUser = c.get('user')
  const { id, scheduleId } = c.req.valid('param')

  const workspace = await getWorkspace(id)
  if (!workspace || workspace.user_id !== currentUser.sub) {
    return c.json({ error: 'Workspace not found' }, 404)
  }

  const existing = await getSchedule(scheduleId)
  if (!existing || existing.workspace_id !== id) {
    return c.json({ error: 'Schedule not found' }, 404)
  }
  if (existing.completed_at) {
    return c.json({ error: 'Cannot edit a completed one-time schedule' }, 400)
  }

  const body = c.req.valid('json')
  if (existing.origin === 'template' && Object.keys(body).some((k) => k !== 'enabled')) {
    return c.json(
      {
        error:
          'Template-provided schedule is read-only except enable/disable; fork it to customize',
      },
      400,
    )
  }
  if (body.run_at && new Date(body.run_at).getTime() <= Date.now()) {
    return c.json({ error: 'run_at must be in the future' }, 400)
  }

  const schedule = await updateSchedule(scheduleId, body)
  if (!schedule) return c.json({ error: 'Schedule not found' }, 404)

  const timerChanged =
    body.cron !== undefined ||
    body.run_at !== undefined ||
    body.timezone !== undefined ||
    body.enabled !== undefined
  if (timerChanged) {
    await jobs.cancelScheduleTimer(existing)
    if (schedule.enabled) {
      const pgbossJobId = await jobs.enqueueScheduleTimer(schedule)
      if (pgbossJobId !== schedule.pgboss_job_id) {
        await updateSchedule(scheduleId, { pgboss_job_id: pgbossJobId })
      }
    } else if (existing.pgboss_job_id) {
      await updateSchedule(scheduleId, { pgboss_job_id: null })
    }
  }

  const final = (await getSchedule(scheduleId)) ?? schedule
  return c.json({ schedule: final }, 200)
})

// ── DELETE /:id/schedules/:scheduleId ──────────────────────────────────────
const deleteRouteDef = createRoute({
  method: 'delete',
  path: '/{id}/schedules/{scheduleId}',
  tags: ['workspaces'],
  summary: 'Delete a schedule and unregister its pg-boss timer',
  security: [{ bearerAuth: [] }],
  request: { params: ScheduleParam },
  responses: {
    200: { description: 'Deleted', content: { 'application/json': { schema: SuccessSchema } } },
    400: {
      description: 'Template-provided schedule cannot be deleted',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Workspace or schedule not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

schedules.openapi(deleteRouteDef, async (c) => {
  const currentUser = c.get('user')
  const { id, scheduleId } = c.req.valid('param')

  const workspace = await getWorkspace(id)
  if (!workspace || workspace.user_id !== currentUser.sub) {
    return c.json({ error: 'Workspace not found' }, 404)
  }

  const existing = await getSchedule(scheduleId)
  if (!existing || existing.workspace_id !== id) {
    return c.json({ error: 'Schedule not found' }, 404)
  }
  if (existing.origin === 'template') {
    return c.json(
      { error: 'Template-provided schedule cannot be deleted; disable it instead' },
      400,
    )
  }

  await jobs.cancelScheduleTimer(existing)
  await deleteSchedule(scheduleId)
  return c.json({ success: true }, 200)
})

// ── POST /:id/schedules/:scheduleId/run ────────────────────────────────────
//
// Run-now: enqueue a one-off job with the same payload the cron timer would
// have fired. Disabled schedules can still be run manually so users can
// reuse a paused schedule to test or trigger ad-hoc.
const runRouteDef = createRoute({
  method: 'post',
  path: '/{id}/schedules/{scheduleId}/run',
  tags: ['workspaces'],
  summary: 'Trigger a schedule immediately, bypassing its scheduled time',
  security: [{ bearerAuth: [] }],
  request: { params: ScheduleParam },
  responses: {
    200: {
      description: 'Run enqueued',
      content: {
        'application/json': {
          schema: z.object({ job_id: z.string().nullable() }),
        },
      },
    },
    404: {
      description: 'Workspace or schedule not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

schedules.openapi(runRouteDef, async (c) => {
  const currentUser = c.get('user')
  const { id, scheduleId } = c.req.valid('param')

  const workspace = await getWorkspace(id)
  if (!workspace || workspace.user_id !== currentUser.sub) {
    return c.json({ error: 'Workspace not found' }, 404)
  }

  const existing = await getSchedule(scheduleId)
  if (!existing || existing.workspace_id !== id) {
    return c.json({ error: 'Schedule not found' }, 404)
  }

  const jobId = await jobs.sendJob({
    workspace_id: id,
    prompt: '',
    trigger: { type: 'cron', payload: { schedule_id: scheduleId } },
  })

  return c.json({ job_id: jobId }, 200)
})

export default schedules
