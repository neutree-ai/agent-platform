import { ensureTokenForSession, mintToken } from '../../lib/session-token'
import { createInterceptedSSEResponse } from '../../lib/sse'
import { resolveAgentAddress } from '../../lib/workspace-address'
import { addMessage, insertUserMessageBlocks } from '../db/messages'
import {
  getSession,
  restorePendingMessage,
  takePendingMessage,
  transitionSessionStatus,
} from '../db/sessions'
import { addTeamworkSession } from '../db/teamwork'
import type { Workspace } from '../db/types'
import { getWorkspace } from '../db/workspaces'
import { pickReplicaForTurn } from '../replica-router'
import { WorkspaceStartError, ensureWorkspaceRunning } from '../workspace-autostart'
import { type ChatImage, buildAgentChatBody, buildUserMessageBlocks } from './request'
import { TurnCapacityError, type TurnSlot, acquireTurn } from './turn-gate'

interface ExecuteChatOpts {
  workspace: Workspace
  message: string
  /** Existing session to continue, or null to let the agent create a new one. */
  sessionId: string | null
  images: ChatImage[] | null
  source: string
  /** Who initiated the turn (used for session audit on new-session creation). */
  callerUserId?: string
  /**
   * Optional teamwork task context. When set, the new (or resumed) session
   * is registered as the coordinator session for this task, and the MCP
   * handler will reverse-resolve task scope from session_id via
   * `teamwork_sessions`. Replaces the legacy `X-Task-Id` MCP header path.
   * The caller is responsible for validating ownership + coordinator
   * binding before passing this; executeChat treats it as already-trusted.
   */
  taskId?: string | null
}

/**
 * Start a chat turn against a workspace's agent pod, returning an SSE
 * Response that the HTTP handler can stream to the client.
 *
 * This function does not do ACL or workspace lookup — the caller is
 * expected to have already resolved + authorized the workspace. Its job
 * is:
 *
 *   1. Pre-persist the user message for existing sessions (so it survives
 *      a client refresh before `session.started` arrives).
 *   2. POST to the agent pod's `/chat` with a 30-minute hard timeout
 *      (decoupled from client signal — a client disconnect must not kill
 *      the turn; reconnects happen via `/_proxy/agent/:wid/cp-reconnect`).
 *   3. Wrap the agent's SSE via `createInterceptedSSEResponse`, which
 *      handles persistence (session + messages + stats) and broadcast
 *      (for cp-reconnect clients).
 *   4. Provide a reconnect factory so `runTurn` can hit the agent's
 *      `/sessions/:id/reconnect` if the primary stream dies mid-turn.
 *
 * Returns the SSE Response on success, or a JSON error Response (502)
 * if the agent fetch fails outright.
 */
export async function executeChat(opts: ExecuteChatOpts): Promise<Response> {
  const { workspace, images, source, callerUserId } = opts
  const { id: workspaceId } = workspace
  const sessionId = opts.sessionId
  let userMessageText: string | null = opts.message

  // Admit the turn before doing any work. Auto-scaling workspaces are capped at
  // readyReplicas × target (queue / 503 over the cap); static workspaces are
  // only accounted, never blocked. The slot must be released exactly once when
  // the turn ends: the streaming path hands it to the interceptor (onTurnEnd),
  // and EVERY early return below releases it inline first. release() is
  // idempotent, so any belt-and-suspenders double-release is harmless — but a
  // missed one leaks capacity, so a new early return must release too.
  let slot: TurnSlot
  try {
    slot = await acquireTurn(workspaceId)
  } catch (e) {
    if (e instanceof TurnCapacityError) {
      return jsonError('Workspace is busy, please retry shortly', 503)
    }
    throw e
  }

  // Auto-start a stopped workspace before dispatching the turn. Covers every
  // trigger source that funnels through executeChat — interactive chat,
  // scheduled jobs, connector events, batch. Blocks until the agent /health
  // passes (cold-start budget ~90s). Honors the per-workspace auto_start
  // opt-out and fails fast on the error state.
  try {
    await ensureWorkspaceRunning(workspace)
  } catch (e) {
    slot.release()
    if (e instanceof WorkspaceStartError) {
      return jsonError(e.message, 503)
    }
    console.error(`[chat] auto-start failed workspace=${workspaceId}:`, e)
    return jsonError('Failed to start workspace', 503)
  }

  // Reject cross-workspace session ids before we touch the agent. Without
  // this a caller could drive messages belonging to another workspace's
  // session, or create orphan rows with `session_id` pointing at a
  // session that lives under a different workspace_id.
  let boundReplica: number | undefined
  if (sessionId) {
    const session = await getSession(sessionId)
    if (!session || session.workspace_id !== workspaceId) {
      slot.release()
      return jsonError('Session not found for this workspace', 400)
    }
    boundReplica = session.replica_ordinal ?? undefined
  }

  // For an auto-scaling workspace, pin this turn to a specific replica: keep the
  // session's existing binding while its replica is still ready, else rebind /
  // pick fresh (a new session, or a replica that dropped out). Static workspaces
  // report no ready set → undefined → the workspace's default address,
  // byte-identical to before. The chosen id is threaded to the interceptor so
  // `session.started` persists the binding for the session's next turns.
  const replicaId = pickReplicaForTurn(workspaceId, boundReplica)
  const address = resolveAgentAddress(workspaceId, { sessionId, replicaId })

  // Mint (or look up) the session_token before dispatching. For a resume
  // the same token follows the session across turns; for a new session we
  // mint with NULL session_id and the persist plugin binds the SDK-revealed
  // id on `session.started`. The agent threads this through to the MCP
  // transport as `X-Session-Token`.
  const sessionToken = sessionId
    ? await ensureTokenForSession(workspaceId, sessionId)
    : await mintToken({ workspaceId })

  const agentBody = JSON.stringify(
    buildAgentChatBody({
      message: userMessageText,
      sessionId,
      images,
      source,
      sessionToken,
    }),
  )

  // 24-hour hard cap. Deliberately decoupled from the client's signal —
  // see `createInterceptedSSEResponse` for why: the agent turn is
  // broadcast to any client attached via cp-reconnect, so losing the
  // initiating client shouldn't kill the turn.
  const fetchSignal = AbortSignal.timeout(24 * 60 * 60 * 1000)

  const agentHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  let response: Response
  try {
    response = await fetch(`${address}/chat`, {
      method: 'POST',
      headers: agentHeaders,
      body: agentBody,
      signal: fetchSignal,
    })
  } catch (e: any) {
    console.error(`[chat] Agent fetch failed workspace=${workspaceId}:`, e.message)
    slot.release()
    if (sessionId) {
      await transitionSessionStatus(sessionId, 'idle').catch(() => {})
    }
    return jsonError('Agent unavailable', 502)
  }

  if (!response.headers.get('Content-Type')?.includes('text/event-stream')) {
    // Non-SSE error from the agent (e.g. 4xx/5xx JSON). Pass the body
    // through so the caller can see what the agent said.
    slot.release()
    const text = await response.text().catch(() => '')
    return new Response(text || JSON.stringify({ error: 'Agent returned non-SSE response' }), {
      status: response.status || 502,
      headers: {
        'Content-Type': response.headers.get('Content-Type') || 'application/json',
      },
    })
  }

  if (sessionId) {
    await transitionSessionStatus(sessionId, 'agent')
    // Eagerly persist the user message while the agent turn is running,
    // so a page refresh can't lose it. For new sessions we defer to
    // `createInterceptedSSEResponse`, which stores the message once
    // `session.started` assigns an id.
    if (userMessageText) {
      const blocks = buildUserMessageBlocks(userMessageText, images)
      const msg = await addMessage(workspaceId, sessionId, 'user', userMessageText)
      await insertUserMessageBlocks(msg.id, sessionId, blocks)
      userMessageText = null // prevent the interceptor from persisting a duplicate
    }
  }

  // Teamwork: when resuming an existing session that wasn't yet registered
  // (e.g. an older session pre-dating this code path), ensure the row is
  // present so MCP-time reverse lookup succeeds on the first tool call.
  // Idempotent: `addTeamworkSession` is INSERT ... ON CONFLICT DO NOTHING.
  if (opts.taskId && sessionId) {
    const tid = opts.taskId
    addTeamworkSession(tid, sessionId, 'coordinator', null).catch((e) => {
      console.warn(
        `[chat] teamwork coordinator registration (resume) failed task=${tid} session=${sessionId}:`,
        e,
      )
    })
  }
  const taskIdForHook = opts.taskId
  const onNewSession = taskIdForHook
    ? async (newSid: string) => {
        await addTeamworkSession(taskIdForHook, newSid, 'coordinator', null)
      }
    : undefined

  return createInterceptedSSEResponse(response, {
    workspaceId,
    userMessageText,
    existingSessionId: sessionId,
    userImages: images,
    callerUserId,
    source,
    reconnectFactory: async (sid) => {
      try {
        const resp = await fetch(`${address}/sessions/${encodeURIComponent(sid)}/reconnect`, {
          method: 'POST',
        })
        if (!resp.ok) return null
        return resp
      } catch (e) {
        console.error(`[chat] reconnect fetch failed workspace=${workspaceId} session=${sid}:`, e)
        return null
      }
    },
    sessionToken,
    onNewSession,
    replicaId,
    // Hand the admission slot to the interceptor: it releases exactly once when
    // the turn terminates (clean end, error, interrupt, or pod death), which is
    // the single point that also frees the accounting for the autoscaler.
    onTurnEnd: () => slot.release(),
  })
}

/**
 * Drain a session's queued follow-up message (if any) into a fresh turn.
 *
 * Called after a turn ends cleanly (`session.ended` reason `completed`, see
 * `createInterceptedSSEResponse`) and from startup recovery when an agent has
 * forgotten an orphaned session. The draft is taken atomically; if dispatch
 * can't happen (workspace down, agent unreachable) it's put back so a later
 * attempt — or the user — can still pick it up.
 *
 * Returns true when a new turn was dispatched. The dispatched turn streams,
 * persists and broadcasts on its own; nobody consumes the returned Response
 * body, so it's cancelled to stop the unread client buffer from growing.
 */
export async function drainPendingMessage(
  workspaceId: string,
  sessionId: string,
): Promise<boolean> {
  const pending = await takePendingMessage(sessionId)
  if (!pending) return false

  const workspace = await getWorkspace(workspaceId)
  if (!workspace || workspace.status !== 'running') {
    await restorePendingMessage(sessionId, pending).catch(() => {})
    console.warn(`[drain] workspace not running, pending kept session=${sessionId}`)
    return false
  }

  try {
    const resp = await executeChat({
      workspace,
      message: pending.content,
      sessionId,
      images: pending.images?.length ? pending.images : null,
      source: 'web',
    })
    if (!resp.headers.get('Content-Type')?.includes('text/event-stream')) {
      await restorePendingMessage(sessionId, pending).catch(() => {})
      console.warn(`[drain] executeChat returned non-SSE session=${sessionId}, pending restored`)
      return false
    }
    void resp.body?.cancel().catch(() => {})
    console.log(`[drain] dispatched pending turn workspace=${workspaceId} session=${sessionId}`)
    return true
  } catch (e) {
    await restorePendingMessage(sessionId, pending).catch(() => {})
    console.error(`[drain] failed to dispatch pending turn session=${sessionId}:`, e)
    return false
  }
}

function jsonError(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
