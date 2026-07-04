import { Hono } from 'hono'
import type { ApiMessage, ApiSession } from '../../../internal/types/api'
import { ensureTokenForSession, mintToken } from '../lib/session-token'
import { createInterceptedSSEResponse } from '../lib/sse'
import type { AppEnv } from '../lib/types'
import { resolveAgentAddress } from '../lib/workspace-address'
import { buildUserMessageBlocks } from '../services/chat/request'
import { addMessage, getMessagesWithBlocks, insertUserMessageBlocks } from '../services/db/messages'
import { getSession, listSessionsByCaller, transitionSessionStatus } from '../services/db/sessions'
import { getWorkspace, listSystemWorkspaces } from '../services/db/workspaces'

const systemWorkspaces = new Hono<AppEnv>()

/** Validate that the workspace exists and is a system workspace. */
async function resolveSystemWs(id: string) {
  const workspace = await getWorkspace(id)
  if (!workspace || !workspace.is_system) return null
  return workspace
}

// List system workspaces (visible to all authenticated users)
systemWorkspaces.get('/', async (c) => {
  const list = await listSystemWorkspaces()
  return c.json(
    list.map((w) => ({
      id: w.id,
      name: w.name,
      slug: w.slug,
      status: w.status,
    })),
  )
})

// List caller's sessions in a system workspace
systemWorkspaces.get('/:id/sessions', async (c) => {
  const workspace = await resolveSystemWs(c.req.param('id'))
  if (!workspace) return c.json({ error: 'System workspace not found' }, 404)

  const userId = c.get('user').sub
  const sessions = await listSessionsByCaller(workspace.id, userId)
  return c.json(sessions.map(toApiSession))
})

// Get a specific session (must be caller's own)
systemWorkspaces.get('/:id/sessions/:sessionId', async (c) => {
  const workspace = await resolveSystemWs(c.req.param('id'))
  if (!workspace) return c.json({ error: 'System workspace not found' }, 404)

  const userId = c.get('user').sub
  const session = await getSession(c.req.param('sessionId'))
  if (!session || session.workspace_id !== workspace.id || session.caller_user_id !== userId) {
    return c.json({ error: 'Session not found' }, 404)
  }

  return c.json(toApiSession(session))
})

// Get messages for a session (must be caller's own)
systemWorkspaces.get('/:id/sessions/:sessionId/messages', async (c) => {
  const workspace = await resolveSystemWs(c.req.param('id'))
  if (!workspace) return c.json({ error: 'System workspace not found' }, 404)

  const userId = c.get('user').sub
  const session = await getSession(c.req.param('sessionId'))
  if (!session || session.workspace_id !== workspace.id || session.caller_user_id !== userId) {
    return c.json({ error: 'Session not found' }, 404)
  }

  const messages = await getMessagesWithBlocks(workspace.id, session.id)
  const response: ApiMessage[] = messages.map((m) => ({
    id: String(m.id),
    role: m.role as 'user' | 'assistant',
    content: m.content,
    blocks: m.blocks as ApiMessage['blocks'],
    created_at: m.created_at,
    started_at: m.started_at,
    ended_at: m.ended_at,
    duration_ms: m.duration_ms,
  }))
  return c.json(response)
})

// Chat with a system workspace (creates or continues a session)
systemWorkspaces.post('/:id/chat', async (c) => {
  const workspace = await resolveSystemWs(c.req.param('id'))
  if (!workspace) return c.json({ error: 'System workspace not found' }, 404)

  if (workspace.status !== 'running') {
    return c.json({ error: 'System workspace not running' }, 503)
  }

  const body = await c.req.text()
  const userId = c.get('user').sub

  // Parse request to extract sessionId and message
  let requestSessionId: string | null = null
  let userMessageText: string | null = null
  let requestImages: Array<{ data: string; media_type: string }> | null = null
  try {
    const parsed = JSON.parse(body)
    requestSessionId = parsed.session_id ?? null
    userMessageText = parsed.message || null
    requestImages = parsed.images || null
  } catch {}

  const address = resolveAgentAddress(workspace.id, { sessionId: requestSessionId })

  // If continuing a session, verify ownership
  if (requestSessionId) {
    const session = await getSession(requestSessionId)
    if (!session || session.workspace_id !== workspace.id || session.caller_user_id !== userId) {
      return c.json({ error: 'Session not found' }, 404)
    }
  }

  const sessionToken = requestSessionId
    ? await ensureTokenForSession(workspace.id, requestSessionId)
    : await mintToken({ workspaceId: workspace.id })

  const agentBody = JSON.stringify({
    message: userMessageText,
    ...(requestSessionId ? { session_id: requestSessionId } : {}),
    ...(requestImages?.length ? { images: requestImages } : {}),
    session_token: sessionToken,
  })

  let response: Response
  try {
    response = await fetch(`${address}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: agentBody,
      signal: AbortSignal.timeout(30 * 60 * 1000),
    })
  } catch (e: any) {
    console.error(`[system-ws] Fetch failed workspace=${workspace.id}:`, e.message)
    if (requestSessionId) {
      await transitionSessionStatus(requestSessionId, 'idle')
    }
    return c.json({ error: 'Agent unavailable' }, 502)
  }

  if (!response.headers.get('Content-Type')?.includes('text/event-stream')) {
    return new Response(response.body, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('Content-Type') || 'application/json',
      },
    })
  }

  // Transition session status
  if (requestSessionId) {
    await transitionSessionStatus(requestSessionId, 'agent')
  }

  // Persist user message for existing sessions
  if (userMessageText && requestSessionId) {
    const blocks = buildUserMessageBlocks(userMessageText, requestImages ?? null)
    const msg = await addMessage(workspace.id, requestSessionId, 'user', userMessageText)
    await insertUserMessageBlocks(msg.id, requestSessionId, blocks)
    userMessageText = null
  }

  return createInterceptedSSEResponse(response, {
    workspaceId: workspace.id,
    userMessageText,
    existingSessionId: requestSessionId,
    userImages: requestImages,
    callerUserId: userId, // set on new sessions
    source: 'web',
    // Reconnect factory: if the primary stream dies before `session.ended`,
    // re-open the agent's buffered sink via `/sessions/:id/reconnect`.
    reconnectFactory: async (sid) => {
      try {
        const resp = await fetch(`${address}/sessions/${encodeURIComponent(sid)}/reconnect`, {
          method: 'POST',
        })
        if (!resp.ok) return null
        return resp
      } catch (e) {
        console.error(
          `[system-ws] reconnect fetch failed workspace=${workspace.id} session=${sid}:`,
          e,
        )
        return null
      }
    },
    sessionToken,
  })
})

function toApiSession(s: any): ApiSession {
  return {
    id: s.id,
    workspace_id: s.workspace_id,
    name: s.name,
    status: s.status,
    chat_status: s.chat_status,
    source: s.source ?? 'web',
    created_at: s.created_at,
    last_active_at: s.last_active_at,
    message_count: s.message_count ?? 0,
    preview: s.preview ?? '',
    last_turn_stats: s.last_turn_stats,
    starred_at: s.starred_at ?? null,
    caller_agent: s.caller_agent_name
      ? { name: s.caller_agent_name, slug: s.caller_agent_slug ?? null }
      : null,
  }
}

export default systemWorkspaces
