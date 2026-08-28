import type { ApiMessage, ChatBody } from '../../../../internal/types/api'
import { aggregateChatStream, awaitSessionId } from '../../lib/sse-aggregate'
import { getMessages } from '../db/messages'
import type { Workspace } from '../db/types'
import { executeChat } from './executeChat'
import { resolveChatMode } from './request'

interface DispatchChatTurnOpts {
  workspace: Workspace
  body: ChatBody
  /** Raw `Accept` header, consulted only when neither `mode` nor `stream` is set. */
  acceptHeader: string | undefined
  callerUserId: string
  /** Teamwork coordinator turns pass the task id; plain workspace chat omits it. */
  taskId?: string | null
}

function jsonResponse(obj: unknown, status: number): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Shared chat dispatch for both `POST /api/workspaces/:id/chat` and the
 * teamwork coordinator `POST /teamwork/:id/chat`. The caller resolves +
 * authorizes the workspace; this owns mode selection, the agent turn, and
 * the three response shapes:
 *
 *   - stream → the intercepted SSE Response, verbatim
 *   - async  → 202 `{ session_id, status: 'running' }` once the session exists
 *   - sync   → 200 aggregated `ChatJsonResponse` after the turn ends
 *
 * A non-SSE agent response (502/503) is passed through verbatim regardless
 * of mode.
 */
export async function dispatchChatTurn(opts: DispatchChatTurnOpts): Promise<Response> {
  const { workspace, body, acceptHeader, callerUserId, taskId } = opts
  const mode = resolveChatMode(body, acceptHeader)
  const sessionId = body.session_id ?? null

  const sseResponse = await executeChat({
    workspace,
    message: body.message,
    sessionId,
    images: body.images ?? null,
    source: body.source,
    callerUserId,
    taskId: taskId ?? null,
  })

  const ct = sseResponse.headers.get('Content-Type') ?? ''
  // Agent error / non-SSE (502/503) — pass through verbatim regardless of mode.
  if (!ct.includes('text/event-stream')) return sseResponse

  if (mode === 'stream') return sseResponse

  if (mode === 'async') {
    // Detach once the session id is known; the turn keeps running and
    // persisting server-side (see awaitSessionId).
    const { sessionId: sid, error } = await awaitSessionId(sseResponse, sessionId)
    if (!sid) return jsonResponse({ error: error ?? 'Failed to start session' }, 502)
    return jsonResponse({ session_id: sid, status: 'running' }, 202)
  }

  // mode === 'sync'
  const agg = await aggregateChatStream(sseResponse)
  const messages = agg.sessionId
    ? ((await getMessages(workspace.id, agg.sessionId)).filter(
        (m) => new Date(m.created_at).getTime() >= agg.startedAt,
      ) as unknown as ApiMessage[])
    : []

  return jsonResponse(
    {
      session_id: agg.sessionId ?? '',
      final_message: agg.finalMessage,
      messages,
      stats: (agg.stats as Record<string, unknown> | null) ?? null,
      reason: agg.reason,
      error: agg.error,
    },
    200,
  )
}
