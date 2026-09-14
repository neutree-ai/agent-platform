import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import {
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { resolveToken } from '../lib/session-token'
import { findTaskBySession, getTeamworkTask } from '../services/db/teamwork'
import { verifyWorkspaceToken } from '../services/db/workspace-tokens'
import { registerTools } from './tools'

function errorResponse(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Handle an incoming MCP request via Streamable HTTP.
 * Creates a fresh server+transport per request (stateless mode).
 * Designed to be called from a Hono route: `return handleMcpRequest(c.req.raw)`
 *
 * This route carries its own auth rather than sitting behind the user-auth
 * middleware: its callers are workspace workloads, not users. The pairing is
 * the same one /workspace/v1 uses (workspaceAuth + requireWorkspaceParam) —
 * `X-Workspace-ID` says which workspace the tools should act on, and the Bearer
 * workspace token is what proves the caller is that workspace's own agent. The
 * header alone is not a credential: workspace ids travel in URLs and share
 * links, and every tool here acts with the workspace owner's reach.
 */
export async function handleMcpRequest(request: Request): Promise<Response> {
  const workspaceId = request.headers.get('x-workspace-id')
  if (!workspaceId) {
    return errorResponse(400, 'X-Workspace-ID header required')
  }

  const authHeader = request.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return errorResponse(401, 'Unauthorized')
  }
  const principal = await verifyWorkspaceToken(authHeader.slice(7))
  if (!principal) {
    return errorResponse(401, 'Unauthorized')
  }
  // Answers 404, not 403, like requireWorkspaceParam: a caller asking about a
  // workspace that is not its own learns nothing about whether it exists.
  if (principal.workspaceId !== workspaceId) {
    console.warn(
      `[mcp] workspace token mismatch: token=${principal.workspaceId} requested=${workspaceId}`,
    )
    return errorResponse(404, 'Workspace not found')
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
