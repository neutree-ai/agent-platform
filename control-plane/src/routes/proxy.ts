import { Hono } from 'hono'
import { createInterceptedSSEResponse, createReconnectSSEResponse } from '../lib/sse'
import type { AppEnv } from '../lib/types'
import { getWorkspaceAddress } from '../lib/workspace-address'
import { transitionSessionStatus } from '../services/db/sessions'
import type { Workspace } from '../services/db/types'
import { getWorkspace } from '../services/db/workspaces'

function canAccessProxy(workspace: Workspace, user: { sub: string; role: string }): boolean {
  return workspace.user_id === user.sub || (workspace.is_system && user.role === 'admin')
}

export function createProxyRoutes() {
  const proxy = new Hono<AppEnv>()

  // CP-level SSE reconnect: attach as live client to an in-flight turn.
  // `session_id` scopes the lookup to the caller's own turn — a workspace
  // can run several concurrent turns, each its own active stream. Omitting
  // it falls back to a workspace-wide match (legacy callers only).
  proxy.post('/agent/:workspaceId/cp-reconnect', async (c) => {
    const workspaceId = c.req.param('workspaceId')
    const sessionId = c.req.query('session_id')
    const currentUser = c.get('user')
    const workspace = await getWorkspace(workspaceId)
    if (!workspace || !canAccessProxy(workspace, currentUser)) {
      return c.json({ error: 'Workspace not found' }, 404)
    }

    const response = createReconnectSSEResponse(workspaceId, sessionId)
    if (!response) {
      return c.json({ error: 'No active stream' }, 404)
    }
    return response
  })

  // Passthrough to the workspace's agent pod for paths whose wire format
  // is owned by the agent (sessions/:sid/reconnect, sessions/:sid/respond,
  // sessions/:sid/pending-question, skills/*). The chat endpoint is now
  // at `/api/workspaces/:id/chat` (OpenAPI-documented, strict ACL) —
  // external callers should use that instead.
  proxy.all('/agent/:workspaceId/*', async (c) => {
    const workspaceId = c.req.param('workspaceId')
    const agentPath = c.req.path.replace(`/_proxy/agent/${workspaceId}`, '')

    const currentUser = c.get('user')
    const workspace = await getWorkspace(workspaceId)
    if (!workspace || !canAccessProxy(workspace, currentUser)) {
      return c.json({ error: 'Workspace not found' }, 404)
    }
    if (workspace.status !== 'running') {
      return c.json({ error: 'Workspace not running' }, 503)
    }

    let body: string | undefined
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      body = await c.req.text()
    }
    const address = getWorkspaceAddress(workspace.id)
    const reqUrl = new URL(c.req.url)
    const targetUrl = `${address}${agentPath}${reqUrl.search}`

    const headers = new Headers()
    const incomingCT = c.req.header('Content-Type')
    headers.set('Content-Type', incomingCT || 'application/json')
    const destination = c.req.header('Destination')
    if (destination) headers.set('Destination', destination)

    const clientSignal = c.req.raw.signal
    let response: Response
    try {
      response = await fetch(targetUrl, {
        method: c.req.method,
        headers,
        body,
        signal: clientSignal,
      })
    } catch (e: any) {
      if (clientSignal.aborted) return new Response(null, { status: 499 })
      console.error(`[proxy] Fetch failed workspace=${workspaceId} path=${agentPath}:`, e.message)
      return c.json({ error: 'Agent unavailable' }, 502)
    }

    // SSE response: intercept for ASQ-answer reconnect, passthrough otherwise.
    const reconnectMatch = agentPath.match(/^\/sessions\/([^/]+)\/reconnect$/)
    if (response.headers.get('Content-Type')?.includes('text/event-stream')) {
      if (reconnectMatch) {
        const reconnectSessionId = decodeURIComponent(reconnectMatch[1])
        await transitionSessionStatus(reconnectSessionId, 'agent')
        return createInterceptedSSEResponse(response, workspaceId, null, reconnectSessionId)
      }
      return new Response(response.body, {
        status: response.status,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      })
    }

    const respHeaders: Record<string, string> = {
      'Content-Type': response.headers.get('Content-Type') || 'application/json',
    }
    const contentDisposition = response.headers.get('Content-Disposition')
    if (contentDisposition) respHeaders['Content-Disposition'] = contentDisposition
    const contentLength = response.headers.get('Content-Length')
    if (contentLength) respHeaders['Content-Length'] = contentLength
    return new Response(response.body, {
      status: response.status,
      headers: respHeaders,
    })
  })

  return proxy
}
