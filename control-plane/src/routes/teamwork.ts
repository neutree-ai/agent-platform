import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  ApiTeamworkParticipantSchema,
  ApiTeamworkRosterCandidateSchema,
  ApiTeamworkSessionSchema,
  ApiTeamworkTaskSchema,
  ChatBodySchema,
  TeamworkParticipantAddBodySchema,
  TeamworkSessionRegisterBodySchema,
  TeamworkTaskCreateBodySchema,
  TeamworkTaskPatchBodySchema,
} from '../../../internal/types/api'
import type { AppEnv } from '../lib/types'
import { UniversalEventSchema } from '../openapi/events.schema'
import { dispatchChatTurn } from '../services/chat/dispatchChatTurn'
import { getSession } from '../services/db/sessions'
import {
  type TeamworkParticipantWithWorkspace,
  type TeamworkTask,
  addTeamworkParticipant,
  addTeamworkSession,
  createTeamworkTask,
  deleteTeamworkTask,
  getTeamworkTask,
  listRosterCandidates,
  listTeamworkParticipants,
  listTeamworkSessions,
  listTeamworkTasksForOwner,
  removeTeamworkParticipant,
  updateTeamworkTask,
} from '../services/db/teamwork'
import { getWorkspace } from '../services/db/workspaces'
import {
  mountTeamworkShareForMember,
  provisionTeamworkShare,
  teardownTeamworkShare,
  unmountTeamworkShareForMember,
} from '../services/teamwork'

const teamwork = new OpenAPIHono<AppEnv>()

const ErrorSchema = z.object({ error: z.string() })
const SuccessSchema = z.object({ success: z.boolean() })

const IdParam = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' } }),
})

const ParticipantParam = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' } }),
  workspaceId: z.string().openapi({ param: { name: 'workspaceId', in: 'path' } }),
})

function toApiTask(t: TeamworkTask): z.infer<typeof ApiTeamworkTaskSchema> {
  return {
    id: t.id,
    owner_user_id: t.owner_user_id,
    name: t.name,
    brief: t.brief,
    coordinator_workspace_id: t.coordinator_workspace_id,
    afs_share_id: t.afs_share_id,
    created_at: t.created_at instanceof Date ? t.created_at.toISOString() : String(t.created_at),
    updated_at: t.updated_at instanceof Date ? t.updated_at.toISOString() : String(t.updated_at),
  }
}

function toApiParticipant(
  p: TeamworkParticipantWithWorkspace,
): z.infer<typeof ApiTeamworkParticipantSchema> {
  return {
    workspace_id: p.workspace_id,
    workspace_name: p.workspace_name,
    workspace_slug: p.workspace_slug,
    workspace_visibility: p.workspace_visibility,
    joined_at: p.joined_at instanceof Date ? p.joined_at.toISOString() : String(p.joined_at),
  }
}

// ── GET /roster-candidates ─────────────────────────────────────────────────
// Listed before /:id so the literal segment doesn't collide with the param.
const rosterCandidatesRoute = createRoute({
  method: 'get',
  path: '/roster-candidates',
  tags: ['teamwork'],
  summary: 'List workspaces eligible to join a teamwork roster',
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Candidates',
      content: { 'application/json': { schema: z.array(ApiTeamworkRosterCandidateSchema) } },
    },
  },
})

teamwork.openapi(rosterCandidatesRoute, async (c) => {
  const user = c.get('user')
  const list = await listRosterCandidates(user.sub)
  return c.json(
    list.map((w) => ({
      id: w.id,
      slug: w.slug,
      name: w.name,
      owner: w.owner_name,
      visibility: w.visibility,
      is_own: w.user_id === user.sub,
      status: w.status,
    })),
    200,
  )
})

// ── GET / ──────────────────────────────────────────────────────────────────
const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['teamwork'],
  summary: 'List teamwork tasks owned by the current user',
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Tasks',
      content: { 'application/json': { schema: z.array(ApiTeamworkTaskSchema) } },
    },
  },
})

teamwork.openapi(listRoute, async (c) => {
  const user = c.get('user')
  const rows = await listTeamworkTasksForOwner(user.sub)
  return c.json(rows.map(toApiTask), 200)
})

// ── POST / ─────────────────────────────────────────────────────────────────
const createRouteDef = createRoute({
  method: 'post',
  path: '/',
  tags: ['teamwork'],
  summary: 'Create a teamwork task. The selected workspace becomes its coordinator.',
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { 'application/json': { schema: TeamworkTaskCreateBodySchema } } },
  },
  responses: {
    201: {
      description: 'Created task',
      content: { 'application/json': { schema: ApiTeamworkTaskSchema } },
    },
    400: { description: 'Bad request', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

teamwork.openapi(createRouteDef, async (c) => {
  const user = c.get('user')
  const body = c.req.valid('json')
  const ws = await getWorkspace(body.coordinator_workspace_id)
  if (!ws || ws.user_id !== user.sub) {
    return c.json({ error: 'Coordinator workspace not found or not owned by you' }, 400)
  }
  if (ws.status !== 'running') {
    return c.json(
      { error: 'Coordinator workspace must be running to provision shared folder' },
      400,
    )
  }
  const task = await createTeamworkTask(user.sub, body.name, ws.id, body.brief)
  try {
    await provisionTeamworkShare(task)
  } catch (e) {
    // Provision failed — drop the task so the user can retry cleanly. Avoid
    // leaving a half-set-up task with no shared folder.
    await deleteTeamworkTask(task.id)
    return c.json({ error: `Failed to provision shared folder: ${(e as Error).message}` }, 400)
  }
  const refreshed = (await getTeamworkTask(task.id)) ?? task
  return c.json(toApiTask(refreshed), 201)
})

// ── GET /:id ───────────────────────────────────────────────────────────────
const getRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['teamwork'],
  summary: 'Get task detail (owner only)',
  security: [{ bearerAuth: [] }],
  request: { params: IdParam },
  responses: {
    200: {
      description: 'Task',
      content: { 'application/json': { schema: ApiTeamworkTaskSchema } },
    },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

teamwork.openapi(getRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const task = await getTeamworkTask(id)
  if (!task || task.owner_user_id !== user.sub) {
    return c.json({ error: 'Task not found' }, 404)
  }
  return c.json(toApiTask(task), 200)
})

// ── PATCH /:id ─────────────────────────────────────────────────────────────
const patchRoute = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['teamwork'],
  summary: 'Update task name/brief (owner only)',
  security: [{ bearerAuth: [] }],
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: TeamworkTaskPatchBodySchema } } },
  },
  responses: {
    200: {
      description: 'Updated',
      content: { 'application/json': { schema: ApiTeamworkTaskSchema } },
    },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

teamwork.openapi(patchRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const body = c.req.valid('json')
  const task = await getTeamworkTask(id)
  if (!task || task.owner_user_id !== user.sub) {
    return c.json({ error: 'Task not found' }, 404)
  }
  const updated = await updateTeamworkTask(id, body)
  if (!updated) return c.json({ error: 'Task not found' }, 404)
  return c.json(toApiTask(updated), 200)
})

// ── DELETE /:id ────────────────────────────────────────────────────────────
const deleteRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['teamwork'],
  summary: 'Delete a task (owner only). Cascades to participants.',
  security: [{ bearerAuth: [] }],
  request: { params: IdParam },
  responses: {
    200: { description: 'Deleted', content: { 'application/json': { schema: SuccessSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

teamwork.openapi(deleteRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const task = await getTeamworkTask(id)
  if (!task || task.owner_user_id !== user.sub) {
    return c.json({ error: 'Task not found' }, 404)
  }
  if (task.afs_share_id) {
    await teardownTeamworkShare(task.afs_share_id)
  }
  await deleteTeamworkTask(id)
  return c.json({ success: true }, 200)
})

// ── GET /:id/participants ──────────────────────────────────────────────────
const listParticipantsRoute = createRoute({
  method: 'get',
  path: '/{id}/participants',
  tags: ['teamwork'],
  summary: 'List task roster (owner only)',
  security: [{ bearerAuth: [] }],
  request: { params: IdParam },
  responses: {
    200: {
      description: 'Participants',
      content: { 'application/json': { schema: z.array(ApiTeamworkParticipantSchema) } },
    },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

teamwork.openapi(listParticipantsRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const task = await getTeamworkTask(id)
  if (!task || task.owner_user_id !== user.sub) {
    return c.json({ error: 'Task not found' }, 404)
  }
  const rows = await listTeamworkParticipants(id)
  return c.json(rows.map(toApiParticipant), 200)
})

// ── POST /:id/participants ─────────────────────────────────────────────────
const addParticipantRoute = createRoute({
  method: 'post',
  path: '/{id}/participants',
  tags: ['teamwork'],
  summary: 'Add a workspace to the task roster (owner only)',
  security: [{ bearerAuth: [] }],
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: TeamworkParticipantAddBodySchema } } },
  },
  responses: {
    201: {
      description: 'Added',
      content: { 'application/json': { schema: ApiTeamworkParticipantSchema } },
    },
    400: { description: 'Bad request', content: { 'application/json': { schema: ErrorSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

teamwork.openapi(addParticipantRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const body = c.req.valid('json')
  const task = await getTeamworkTask(id)
  if (!task || task.owner_user_id !== user.sub) {
    return c.json({ error: 'Task not found' }, 404)
  }
  if (body.workspace_id === task.coordinator_workspace_id) {
    return c.json({ error: 'Coordinator cannot also be a roster member' }, 400)
  }

  const ws = await getWorkspace(body.workspace_id)
  if (!ws) return c.json({ error: 'Workspace not found' }, 400)
  // Same callable-set as call_agent: own workspace, or someone else's public one.
  const callable = ws.user_id === user.sub || ws.visibility === 'public'
  if (!callable) return c.json({ error: 'Workspace is not callable by you' }, 400)
  if (ws.status !== 'running') {
    return c.json({ error: 'Workspace must be running to mount the shared folder' }, 400)
  }

  await addTeamworkParticipant(id, ws.id)
  if (task.afs_share_id) {
    try {
      await mountTeamworkShareForMember(task.afs_share_id, task.id, ws.id)
    } catch (e) {
      // Roll back the participant row so state stays consistent.
      await removeTeamworkParticipant(id, ws.id)
      return c.json({ error: `Failed to mount shared folder: ${(e as Error).message}` }, 400)
    }
  }

  const all = await listTeamworkParticipants(id)
  const added = all.find((p) => p.workspace_id === ws.id)
  if (!added) return c.json({ error: 'Failed to add participant' }, 400)
  return c.json(toApiParticipant(added), 201)
})

// ── DELETE /:id/participants/:workspaceId ──────────────────────────────────
const removeParticipantRoute = createRoute({
  method: 'delete',
  path: '/{id}/participants/{workspaceId}',
  tags: ['teamwork'],
  summary: 'Remove a workspace from the task roster (owner only)',
  security: [{ bearerAuth: [] }],
  request: { params: ParticipantParam },
  responses: {
    200: { description: 'Removed', content: { 'application/json': { schema: SuccessSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

teamwork.openapi(removeParticipantRoute, async (c) => {
  const user = c.get('user')
  const { id, workspaceId } = c.req.valid('param')
  const task = await getTeamworkTask(id)
  if (!task || task.owner_user_id !== user.sub) {
    return c.json({ error: 'Task not found' }, 404)
  }
  const ok = await removeTeamworkParticipant(id, workspaceId)
  if (!ok) return c.json({ error: 'Participant not found' }, 404)
  if (task.afs_share_id) {
    await unmountTeamworkShareForMember(task.afs_share_id, task.id, workspaceId)
  }
  return c.json({ success: true }, 200)
})

// ── GET /:id/sessions ──────────────────────────────────────────────────────
const listSessionsRoute = createRoute({
  method: 'get',
  path: '/{id}/sessions',
  tags: ['teamwork'],
  summary: 'List chat sessions associated with this task',
  security: [{ bearerAuth: [] }],
  request: { params: IdParam },
  responses: {
    200: {
      description: 'Sessions',
      content: { 'application/json': { schema: z.array(ApiTeamworkSessionSchema) } },
    },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

teamwork.openapi(listSessionsRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const task = await getTeamworkTask(id)
  if (!task || task.owner_user_id !== user.sub) {
    return c.json({ error: 'Task not found' }, 404)
  }
  const rows = await listTeamworkSessions(id)
  return c.json(
    rows.map((s) => ({
      task_id: s.task_id,
      session_id: s.session_id,
      role: s.role,
      parent_session_id: s.parent_session_id,
      created_at: s.created_at instanceof Date ? s.created_at.toISOString() : String(s.created_at),
    })),
    200,
  )
})

// ── POST /:id/sessions ─────────────────────────────────────────────────────
//
// Idempotent registration. Called from the embedded chat panel's
// onSessionCreated hook the moment a fresh coordinator session shows up.
// Member-session linkage will reuse the same endpoint with role='member'
// and parent_session_id once sidecars can pass session_id through MCP.
const registerSessionRoute = createRoute({
  method: 'post',
  path: '/{id}/sessions',
  tags: ['teamwork'],
  summary: 'Register a chat session as belonging to this task',
  security: [{ bearerAuth: [] }],
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: TeamworkSessionRegisterBodySchema } } },
  },
  responses: {
    200: {
      description: 'Registered',
      content: { 'application/json': { schema: ApiTeamworkSessionSchema } },
    },
    400: { description: 'Bad request', content: { 'application/json': { schema: ErrorSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

teamwork.openapi(registerSessionRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const body = c.req.valid('json')
  const role = body.role ?? 'coordinator'

  const task = await getTeamworkTask(id)
  if (!task || task.owner_user_id !== user.sub) {
    return c.json({ error: 'Task not found' }, 404)
  }

  const session = await getSession(body.session_id)
  if (!session) return c.json({ error: 'Session not found' }, 400)

  // Coordinator sessions must live in the coordinator workspace; member
  // sessions live in roster workspaces. Either way, refuse arbitrary cross-
  // workspace registration.
  if (role === 'coordinator' && session.workspace_id !== task.coordinator_workspace_id) {
    return c.json({ error: 'Coordinator session must live in the coordinator workspace' }, 400)
  }

  await addTeamworkSession(id, body.session_id, role, body.parent_session_id ?? null)
  const rows = await listTeamworkSessions(id)
  const row = rows.find((r) => r.session_id === body.session_id)
  if (!row) return c.json({ error: 'Failed to register session' }, 400)
  return c.json(
    {
      task_id: row.task_id,
      session_id: row.session_id,
      role: row.role,
      parent_session_id: row.parent_session_id,
      created_at:
        row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    },
    200,
  )
})

// ── POST /:id/chat ─────────────────────────────────────────────────────────
//
// Task-scoped coordinator chat. The task id in the URL is the trust anchor:
// cp validates here, then propagates `X-Task-Id` to the sidecar (and from
// there into the LLM's MCP transport) so the platform MCP server can grant
// task-roster scope to call_agent dispatches. The generic
// /api/workspaces/:id/chat stays teamwork-unaware.
const ChatJsonResponseDoc = z.object({
  session_id: z.string(),
  final_message: z.string(),
  messages: z.array(z.record(z.string(), z.any())),
  stats: z.record(z.string(), z.any()).nullable(),
  reason: z.enum(['ended', 'timeout', 'error', 'disconnected']),
  error: z.string().nullable(),
})

const ChatAsyncResponseDoc = z.object({
  session_id: z.string(),
  status: z.literal('running'),
})

const chatRouteDef = createRoute({
  method: 'post',
  path: '/{id}/chat',
  tags: ['teamwork'],
  summary: 'Run a chat turn in the task coordinator with task-scope MCP authority',
  description: [
    'Same delivery modes as `POST /api/workspaces/:id/chat` (`body.mode`:',
    '`stream` default, `sync`, `async` recommended) — see that route for the',
    'mode semantics. This variant runs the turn in the task coordinator with',
    'task-scope MCP authority.',
  ].join('\n'),
  security: [{ bearerAuth: [] }],
  request: {
    params: IdParam,
    body: { required: true, content: { 'application/json': { schema: ChatBodySchema } } },
  },
  responses: {
    200: {
      description: 'Chat turn output (SSE by default, JSON in `sync` mode).',
      content: {
        'application/json': { schema: ChatJsonResponseDoc },
        'text/event-stream': { schema: UniversalEventSchema },
      },
    },
    202: {
      description: 'Async mode — turn accepted and running; returns the session id.',
      content: { 'application/json': { schema: ChatAsyncResponseDoc } },
    },
    400: { description: 'Bad request', content: { 'application/json': { schema: ErrorSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    502: {
      description: 'Agent unavailable',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    503: {
      description: 'Coordinator not running',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

teamwork.openapi(chatRouteDef, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const body = c.req.valid('json')

  const task = await getTeamworkTask(id)
  if (!task || task.owner_user_id !== user.sub) {
    return c.json({ error: 'Task not found' }, 404)
  }

  const coord = await getWorkspace(task.coordinator_workspace_id)
  if (!coord) {
    return c.json({ error: 'Coordinator workspace not found' }, 404)
  }
  // A stopped coordinator is auto-started inside executeChat (which also
  // returns the 503 if auto-start is disabled or the cold-start times out).

  return dispatchChatTurn({
    workspace: coord,
    body,
    acceptHeader: c.req.header('Accept'),
    callerUserId: user.sub,
    taskId: task.id,
  })
})

export default teamwork
