import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  ApiPendingMessageSchema,
  ApiSessionLiteSchema,
  ApiSessionToolActivitySchema,
  ApiSessionUsageSchema,
} from '../../../../internal/types/api'
import type { AppEnv } from '../../lib/types'
import { resolveAgentAddress } from '../../lib/workspace-address'
import { pool } from '../../services/db/pool'
import { listSessionToolCalls } from '../../services/db/session-tool-calls'
import {
  clearPendingMessage,
  deleteSession,
  getSession,
  renameSession,
  setPendingMessage,
  setSessionStarred,
} from '../../services/db/sessions'
import { getSessionUsage, getSessionUsageOwner } from '../../services/db/workspace-usage'
import { getWorkspace } from '../../services/db/workspaces'
import { summarizeToolActivity } from '../../services/session-tool-activity'
import { settleSessionUsage } from '../../services/usage/settle'
import { canManage, interruptAgentSession } from './_shared'

const sessions = new OpenAPIHono<AppEnv>()

const ErrorSchema = z.object({ error: z.string() })
const SuccessSchema = z.object({ success: z.boolean() })
const InterruptResponseSchema = z.object({
  success: z.boolean(),
  interrupted: z.boolean().optional(),
})

const SessionScopedParam = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' } }),
  sessionId: z.string().openapi({ param: { name: 'sessionId', in: 'path' } }),
})

// ── GET /:id/sessions/:sessionId ───────────────────────────────────────────
const getSessionRoute = createRoute({
  method: 'get',
  path: '/{id}/sessions/{sessionId}',
  tags: ['workspaces'],
  summary: 'Get a single session (lightweight, sidebar shape)',
  description:
    'Returns a lite shape with id, name, chat_status, status, last_active_at, and a 40-char preview of the first user message. Use GET /workspaces/:id/sessions for the full ApiSession list.',
  security: [{ bearerAuth: [] }],
  request: { params: SessionScopedParam },
  responses: {
    200: {
      description: 'Session',
      content: { 'application/json': { schema: ApiSessionLiteSchema } },
    },
    404: {
      description: 'Workspace or session not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

sessions.openapi(getSessionRoute, async (c) => {
  const currentUser = c.get('user')
  const { id, sessionId } = c.req.valid('param')

  const workspace = await getWorkspace(id)
  if (!workspace || !canManage(workspace, currentUser)) {
    return c.json({ error: 'Workspace not found' }, 404)
  }

  const session = await getSession(sessionId)
  if (!session || session.workspace_id !== id) {
    return c.json({ error: 'Session not found' }, 404)
  }

  const { rows } = await pool.query(
    `SELECT LEFT(content, 40) AS preview FROM messages
     WHERE session_id = $1 AND role = 'user'
     ORDER BY created_at ASC LIMIT 1`,
    [sessionId],
  )

  return c.json(
    {
      id: session.id,
      name: session.name,
      chat_status: session.chat_status,
      status: session.status,
      last_active_at: session.last_active_at,
      preview: rows[0]?.preview ?? '',
      pending_message: session.pending_message ?? null,
    },
    200,
  )
})

// ── PATCH /:id/sessions/:sessionId ─────────────────────────────────────────
const RenameSessionBodySchema = z.object({
  name: z.string().min(1),
})

const renameSessionRoute = createRoute({
  method: 'patch',
  path: '/{id}/sessions/{sessionId}',
  tags: ['workspaces'],
  summary: 'Rename a session',
  security: [{ bearerAuth: [] }],
  request: {
    params: SessionScopedParam,
    body: { content: { 'application/json': { schema: RenameSessionBodySchema } } },
  },
  responses: {
    200: { description: 'Renamed', content: { 'application/json': { schema: SuccessSchema } } },
    400: { description: 'Invalid input', content: { 'application/json': { schema: ErrorSchema } } },
    404: {
      description: 'Workspace or session not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

sessions.openapi(renameSessionRoute, async (c) => {
  const currentUser = c.get('user')
  const { id, sessionId } = c.req.valid('param')
  const { name } = c.req.valid('json')

  const workspace = await getWorkspace(id)
  if (!workspace || !canManage(workspace, currentUser)) {
    return c.json({ error: 'Workspace not found' }, 404)
  }

  const trimmed = name.trim()
  if (!trimmed) {
    return c.json({ error: 'name is required and cannot be empty' }, 400)
  }

  const updated = await renameSession(sessionId, trimmed)
  if (!updated) {
    return c.json({ error: 'Session not found' }, 404)
  }

  return c.json({ success: true }, 200)
})

// ── DELETE /:id/sessions/:sessionId ────────────────────────────────────────
const deleteSessionRoute = createRoute({
  method: 'delete',
  path: '/{id}/sessions/{sessionId}',
  tags: ['workspaces'],
  summary: 'Delete a session and its messages',
  description:
    'Interrupts the agent (if running), then drops the session row and its messages. The workspace chat_status cache is refreshed automatically.',
  security: [{ bearerAuth: [] }],
  request: { params: SessionScopedParam },
  responses: {
    200: { description: 'Deleted', content: { 'application/json': { schema: SuccessSchema } } },
    404: {
      description: 'Workspace not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

sessions.openapi(deleteSessionRoute, async (c) => {
  const currentUser = c.get('user')
  const { id, sessionId } = c.req.valid('param')

  const workspace = await getWorkspace(id)
  if (!workspace || !canManage(workspace, currentUser)) {
    return c.json({ error: 'Workspace not found' }, 404)
  }

  console.log(`[DeleteSession] Request workspace=${id} session=${sessionId}`)

  if (workspace.status === 'running') {
    const address = resolveAgentAddress(workspace.id, { sessionId })
    await interruptAgentSession(address, sessionId, 'DeleteSession')
  }

  await deleteSession(sessionId)
  return c.json({ success: true }, 200)
})

// ── POST /:id/sessions/:sessionId/star ─────────────────────────────────────
// Star / un-star a session. Idempotent: takes the desired state as a boolean
// rather than blind-toggling, so an optimistic UI retry can't double-flip.
const SetStarredBodySchema = z.object({ starred: z.boolean() })
const StarResponseSchema = z.object({ success: z.boolean(), starred: z.boolean() })

const setStarredRoute = createRoute({
  method: 'post',
  path: '/{id}/sessions/{sessionId}/star',
  tags: ['workspaces'],
  summary: 'Star or un-star a session',
  security: [{ bearerAuth: [] }],
  request: {
    params: SessionScopedParam,
    body: { content: { 'application/json': { schema: SetStarredBodySchema } } },
  },
  responses: {
    200: {
      description: 'Updated',
      content: { 'application/json': { schema: StarResponseSchema } },
    },
    404: {
      description: 'Workspace or session not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

sessions.openapi(setStarredRoute, async (c) => {
  const currentUser = c.get('user')
  const { id, sessionId } = c.req.valid('param')
  const { starred } = c.req.valid('json')

  const workspace = await getWorkspace(id)
  if (!workspace || !canManage(workspace, currentUser)) {
    return c.json({ error: 'Workspace not found' }, 404)
  }
  const session = await getSession(sessionId)
  if (!session || session.workspace_id !== id) {
    return c.json({ error: 'Session not found' }, 404)
  }

  await setSessionStarred(sessionId, starred)
  return c.json({ success: true, starred }, 200)
})

// ── POST /:id/sessions/:sessionId/interrupt ────────────────────────────────
const interruptSessionRoute = createRoute({
  method: 'post',
  path: '/{id}/sessions/{sessionId}/interrupt',
  tags: ['workspaces'],
  summary: 'Interrupt a single session (soft stop, preserves history)',
  security: [{ bearerAuth: [] }],
  request: { params: SessionScopedParam },
  responses: {
    200: {
      description: 'Interrupt attempted',
      content: { 'application/json': { schema: InterruptResponseSchema } },
    },
    404: {
      description: 'Workspace not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    503: {
      description: 'Workspace not running',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

sessions.openapi(interruptSessionRoute, async (c) => {
  const currentUser = c.get('user')
  const { id, sessionId } = c.req.valid('param')
  const workspace = await getWorkspace(id)
  if (!workspace || !canManage(workspace, currentUser)) {
    return c.json({ error: 'Workspace not found' }, 404)
  }

  console.log(`[Interrupt] Request workspace=${id} session=${sessionId}`)
  if (workspace.status !== 'running') {
    return c.json({ error: 'Workspace not running' }, 503)
  }
  const address = resolveAgentAddress(workspace.id, { sessionId })

  const { delivered, interrupted } = await interruptAgentSession(address, sessionId, 'Interrupt')
  return c.json({ success: delivered, interrupted }, 200)
})

// ── PUT /:id/sessions/:sessionId/pending ───────────────────────────────────
// Set (replace) the session's queued follow-up draft. The web composer merges
// re-armed input client-side and PUTs the whole draft here.
const putPendingRoute = createRoute({
  method: 'put',
  path: '/{id}/sessions/{sessionId}/pending',
  tags: ['workspaces'],
  summary: 'Set the queued follow-up message for a session',
  security: [{ bearerAuth: [] }],
  request: {
    params: SessionScopedParam,
    body: { content: { 'application/json': { schema: ApiPendingMessageSchema } } },
  },
  responses: {
    200: { description: 'Saved', content: { 'application/json': { schema: SuccessSchema } } },
    404: {
      description: 'Workspace or session not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

sessions.openapi(putPendingRoute, async (c) => {
  const currentUser = c.get('user')
  const { id, sessionId } = c.req.valid('param')
  const body = c.req.valid('json')

  const workspace = await getWorkspace(id)
  if (!workspace || !canManage(workspace, currentUser)) {
    return c.json({ error: 'Workspace not found' }, 404)
  }
  const session = await getSession(sessionId)
  if (!session || session.workspace_id !== id) {
    return c.json({ error: 'Session not found' }, 404)
  }

  await setPendingMessage(sessionId, body)
  return c.json({ success: true }, 200)
})

// ── DELETE /:id/sessions/:sessionId/pending ────────────────────────────────
const deletePendingRoute = createRoute({
  method: 'delete',
  path: '/{id}/sessions/{sessionId}/pending',
  tags: ['workspaces'],
  summary: 'Drop the queued follow-up message for a session',
  security: [{ bearerAuth: [] }],
  request: { params: SessionScopedParam },
  responses: {
    200: { description: 'Cleared', content: { 'application/json': { schema: SuccessSchema } } },
    404: {
      description: 'Workspace or session not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

sessions.openapi(deletePendingRoute, async (c) => {
  const currentUser = c.get('user')
  const { id, sessionId } = c.req.valid('param')

  const workspace = await getWorkspace(id)
  if (!workspace || !canManage(workspace, currentUser)) {
    return c.json({ error: 'Workspace not found' }, 404)
  }
  const session = await getSession(sessionId)
  if (!session || session.workspace_id !== id) {
    return c.json({ error: 'Session not found' }, 404)
  }

  await clearPendingMessage(sessionId)
  return c.json({ success: true }, 200)
})

// ── GET /:id/sessions/:sessionId/usage ─────────────────────────────────────

const getSessionUsageRoute = createRoute({
  method: 'get',
  path: '/{id}/sessions/{sessionId}/usage',
  tags: ['workspaces'],
  summary: 'Get token usage for one session',
  description: [
    'Sums the usage ledger for a single session, split by the model that spent',
    'it. Cache tiers stay in their own columns — cache reads routinely dwarf',
    'input volume at a fraction of the price, so a combined number misranks cost.',
    '',
    '`settlement` says whether the ledger already holds everything the session',
    'spent. Usage arrives by pulling the agent transcripts and the pull fired at',
    'the end of a turn is detached, so a read taken immediately can be short —',
    'poll until `complete`, which for a session that just ended takes about as',
    "long as the parser's settle grace. `reason` distinguishes an account that",
    'is still converging from one nothing will advance.',
  ].join('\n'),
  security: [{ bearerAuth: [] }],
  request: { params: SessionScopedParam },
  responses: {
    200: {
      description: 'Session usage',
      content: { 'application/json': { schema: ApiSessionUsageSchema } },
    },
    404: {
      description: 'Workspace or session not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

sessions.openapi(getSessionUsageRoute, async (c) => {
  const currentUser = c.get('user')
  const { id, sessionId } = c.req.valid('param')

  // The ledger has no foreign key and outlives both the session and the
  // workspace, on purpose: a harness that recycles a workspace after a run must
  // still be able to read what the run cost. So the workspace row is the
  // preferred authorisation anchor, and when it is gone the owner stamped on
  // the ledger rows stands in — narrower, since it admits only that user.
  const workspace = await getWorkspace(id)
  const ledgerOwner = await getSessionUsageOwner(id, sessionId)
  if (workspace) {
    if (!canManage(workspace, currentUser)) return c.json({ error: 'Workspace not found' }, 404)
  } else if (!ledgerOwner || ledgerOwner !== currentUser.sub) {
    return c.json({ error: 'Workspace not found' }, 404)
  }

  // A session cp has never heard of must not read back as a clean zero-cost
  // account — for a caller comparing runs, a mistyped id would look like a free
  // one. Ledger rows or a live session row; either is enough to answer for.
  if (!ledgerOwner) {
    const session = await getSession(sessionId)
    if (!session || session.workspace_id !== id) {
      return c.json({ error: 'Session not found' }, 404)
    }
  }

  const settlement = await settleSessionUsage(id, sessionId)
  const usage = await getSessionUsage(id, sessionId)
  return c.json({ session_id: sessionId, ...usage, settlement }, 200)
})

// ── GET /:id/sessions/:sessionId/tool-activity ─────────────────────────────
const getToolActivityRoute = createRoute({
  method: 'get',
  path: '/{id}/sessions/{sessionId}/tool-activity',
  tags: ['workspaces'],
  summary: "Get a session's tool calls, aggregated by tool and spread over time",
  description: [
    "Where a session's wall clock went: how much of it was spent inside a tool",
    '(overlap counted once, since sub-agents run tools concurrently), which tools',
    'spent it, and how that spending was distributed across the session.',
    '',
    'The distribution is the useful part. An agent repeating one tool without',
    'making progress is indistinguishable from a busy one by any single total,',
    'but shows up in the buckets as a long unbroken stretch of one tool.',
  ].join('\n'),
  security: [{ bearerAuth: [] }],
  request: { params: SessionScopedParam },
  responses: {
    200: {
      description: 'Session tool activity',
      content: { 'application/json': { schema: ApiSessionToolActivitySchema } },
    },
    404: {
      description: 'Workspace or session not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

sessions.openapi(getToolActivityRoute, async (c) => {
  const currentUser = c.get('user')
  const { id, sessionId } = c.req.valid('param')

  // Tool events are deleted with their session, so unlike the usage ledger there
  // is nothing here to read once the workspace is gone — the workspace row is
  // the only authorisation anchor this needs.
  const workspace = await getWorkspace(id)
  if (!workspace || !canManage(workspace, currentUser)) {
    return c.json({ error: 'Workspace not found' }, 404)
  }
  const session = await getSession(sessionId)
  if (!session || session.workspace_id !== id) {
    return c.json({ error: 'Session not found' }, 404)
  }

  return c.json(summarizeToolActivity(await listSessionToolCalls(sessionId)), 200)
})

export default sessions
