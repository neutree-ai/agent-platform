import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { ChatBodySchema } from '../../../../internal/types/api'
import type { AppEnv } from '../../lib/types'
import { UniversalEventSchema } from '../../openapi/events.schema'
import { dispatchChatTurn } from '../../services/chat/dispatchChatTurn'
import { getWorkspace } from '../../services/db/workspaces'
import { canManage } from './_shared'

/**
 * Chat entry point — mounts `POST /api/workspaces/:id/chat`. Mode selection
 * and the three response shapes live in `dispatchChatTurn`, shared with the
 * teamwork coordinator chat route.
 */
const chat = new OpenAPIHono<AppEnv>({
  defaultHook: (result, c) => {
    if (!result.success) {
      return c.json({ error: 'Invalid request', details: result.error.issues ?? result.error }, 400)
    }
  },
})

const ErrorSchema = z.object({ error: z.string() })
const WorkspaceIdParam = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' } }),
})

/**
 * OpenAPI schema for the JSON-mode response. This is a shallow mirror of
 * `ChatJsonResponseSchema` in @neutree-ai/types — we don't reuse that one here
 * because the `messages` array's deep discriminated union (ApiContentPart)
 * explodes zod-openapi's handler-return type inference (TS2589). The
 * authoritative shared shape for consumers lives in @neutree-ai/types; this
 * schema is purely for doc generation.
 */
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

const chatRoute = createRoute({
  method: 'post',
  path: '/{id}/chat',
  tags: ['chat'],
  summary: 'Start (or continue) a chat turn with a workspace agent',
  description: [
    'Triggers a turn against the workspace agent. Three delivery modes via',
    '`body.mode`:',
    '',
    '- `stream` (default) — `text/event-stream` of UniversalEvent frames.',
    '- `sync` — block until the turn ends, return aggregated JSON. Weak for',
    '  long turns; kept for compatibility.',
    '- `async` (recommended) — `202 Accepted` with `{ session_id }` as soon as',
    '  the session exists; the turn keeps running server-side. Poll',
    '  `GET /sessions/:id` and read `GET /messages?session_id=` for results.',
    '',
    'When `mode` is absent, the legacy `body.stream` flag (`true` → stream,',
    '`false` → sync) and then the `Accept` header are consulted; default SSE.',
    '',
    'SSE events follow the agent UniversalEvent schema. Frame shape is',
    'documented as the `UniversalEvent` component (discriminated on `type`):',
    'session.started, item.started, item.delta, item.completed,',
    'question.requested, session.ended, error. Each frame is emitted on a',
    'single `data: <json>\\n\\n` line.',
  ].join('\n'),
  security: [{ bearerAuth: [] }],
  request: {
    params: WorkspaceIdParam,
    body: { required: true, content: { 'application/json': { schema: ChatBodySchema } } },
  },
  responses: {
    200: {
      description: [
        'Chat turn output.',
        '',
        'In SSE mode (default) the response is `text/event-stream` carrying',
        'UniversalEvent frames. In JSON mode (`body.stream: false` or',
        '`Accept: application/json`) the server blocks until the turn',
        'ends and returns the aggregated object documented below.',
      ].join('\n'),
      content: {
        'application/json': { schema: ChatJsonResponseDoc },
        'text/event-stream': { schema: UniversalEventSchema },
      },
    },
    202: {
      description: [
        'Async mode (`body.mode: "async"`) — the turn was accepted and is',
        'running server-side. Returns the session id to poll for results.',
      ].join('\n'),
      content: { 'application/json': { schema: ChatAsyncResponseDoc } },
    },
    400: {
      description: 'Invalid body',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Workspace not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    502: {
      description: 'Agent unavailable',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    503: {
      description: 'Workspace not running',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

chat.openapi(chatRoute, async (c) => {
  const { id } = c.req.valid('param')
  const user = c.get('user')
  const workspace = await getWorkspace(id)
  if (!workspace || !canManage(workspace, user)) {
    return c.json({ error: 'Workspace not found' }, 404)
  }
  // A stopped workspace is auto-started inside executeChat (which also returns
  // the 503 if auto-start is disabled or the cold-start times out).

  const body = c.req.valid('json')
  return dispatchChatTurn({
    workspace,
    body,
    acceptHeader: c.req.header('Accept'),
    callerUserId: user.sub,
  })
})

export default chat
