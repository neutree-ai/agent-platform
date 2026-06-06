import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { resolveToken } from '../lib/session-token'
import { findTaskBySession, getTeamworkTask } from '../services/db/teamwork'
import { registerTools } from './tools'

/**
 * Handle an incoming MCP request via Streamable HTTP.
 * Creates a fresh server+transport per request (stateless mode).
 * Designed to be called from a Hono route: `return handleMcpRequest(c.req.raw)`
 */
export async function handleMcpRequest(request: Request): Promise<Response> {
  const workspaceId = request.headers.get('x-workspace-id')
  if (!workspaceId) {
    return new Response(JSON.stringify({ error: 'X-Workspace-ID header required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // `X-Session-Token` carries the CP-minted proxy id for this session. We
  // reverse-resolve it to a session_id (and, transitively, a task_id via
  // teamwork_sessions) so individual tools can scope their behaviour
  // without the agent having to carry session/task semantics in headers.
  // A missing or unknown token is not fatal — tools degrade to
  // workspace-level (same as a non-teamwork, non-session-aware chat).
  let sessionId: string | null = null
  let taskId: string | null = null
  const tokenHeader = request.headers.get('x-session-token')
  if (tokenHeader) {
    const record = await resolveToken(tokenHeader).catch((e) => {
      console.warn(`[mcp] resolveToken failed token=${tokenHeader}:`, e)
      return null
    })
    if (record && record.workspaceId === workspaceId) {
      sessionId = record.sessionId
    } else if (record) {
      console.warn(
        `[mcp] X-Session-Token workspace mismatch token=${tokenHeader} expected=${workspaceId} actual=${record.workspaceId}`,
      )
    }
    if (sessionId) {
      taskId = await findTaskBySession(sessionId).catch((e) => {
        console.warn(`[mcp] findTaskBySession failed session=${sessionId}:`, e)
        return null
      })
      if (taskId) {
        // Defensive: confirm the task is still coordinated by this workspace
        // before granting task-scoped reach (mirrors the old X-Task-Id
        // validation). A failed check silently drops the task context.
        try {
          const task = await getTeamworkTask(taskId)
          if (!task || task.coordinator_workspace_id !== workspaceId) {
            taskId = null
          }
        } catch (e) {
          console.warn(`[mcp] task validation failed task=${taskId} workspace=${workspaceId}:`, e)
          taskId = null
        }
      }
    }
  }

  const server = new McpServer({
    name: 'tos-platform',
    version: '0.1.0',
  })
  registerTools(server, {
    workspaceId,
    sessionId,
    taskId,
    headers: request.headers,
  })

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)

  return transport.handleRequest(request)
}
