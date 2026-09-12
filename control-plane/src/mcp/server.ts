import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import {
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
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
  // Set from the same token record when this turn is a Reflect run — see
  // mcp/tools.ts's registerTools, which swaps in the Reflect-only toolset
  // instead of doing a second, session-scoped lookup for this.
  let reflectStoreId: string | null = null
  const tokenHeader = request.headers.get('x-session-token')
  if (tokenHeader) {
    const record = await resolveToken(tokenHeader).catch((e) => {
      console.warn(`[mcp] resolveToken failed token=${tokenHeader}:`, e)
      return null
    })
    if (record && record.workspaceId === workspaceId) {
      sessionId = record.sessionId
      reflectStoreId = record.reflectStoreId
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
    reflectStoreId,
    headers: request.headers,
  })
  registerEmptyResources(server)

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)

  return transport.handleRequest(request)
}

/**
 * Answer `resources/list` and `resources/templates/list` with an empty set.
 *
 * This server exposes tools only. Without the capability the SDK omits the
 * handlers, so a client that asks for resources anyway gets `-32601 Method not
 * found` — which agents surface as a tool failure rather than "there are none",
 * costing a wasted call and an error the model then reasons about. Answering
 * with an empty list says the same thing without the error.
 */
function registerEmptyResources(server: McpServer): void {
  server.server.registerCapabilities({ resources: {} })
  server.server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [] }))
  server.server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: [],
  }))
}
