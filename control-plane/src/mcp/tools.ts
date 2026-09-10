import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { getSessionReflectStoreId } from '../services/db/sessions'
import { registerAfsTools } from './tools/afs'
import { registerAgentTools } from './tools/agent'
import { registerBrowserTools } from './tools/browser'
import { registerBuilderTools } from './tools/builder-mode'
import { registerExportFileUrlTool } from './tools/export-file-url'
import { registerMemoryTools } from './tools/memory'
import { registerReflectTools } from './tools/reflect'
import { registerSandboxTools } from './tools/sandbox'
import { registerSkillsTools } from './tools/skills'

/**
 * Per-request context resolved by `handleMcpRequest`. `sessionId` and
 * `taskId` come from reverse-resolving `X-Session-Token`; tools that need
 * either can read directly off this object instead of re-parsing headers.
 */
interface McpRequestContext {
  workspaceId: string
  sessionId: string | null
  taskId: string | null
  headers: Headers
}

/**
 * Pure dispatcher. Each tool registrar reads what it needs off the context
 * — keep this function unaware of specific tool options.
 *
 * A session reflecting on a store (see reconcileReflectSchedule /
 * scheduler/src/handler.ts) gets ONLY the Reflect toolset — no bash,
 * browser, sandbox, other MCP servers, or Builder Mode — to keep a
 * consolidation turn's blast radius small. See memory-store-plan.md 3.3 for
 * why this isn't done via Builder Mode's cap model instead.
 */
export async function registerTools(server: McpServer, ctx: McpRequestContext) {
  const { workspaceId, sessionId, taskId, headers } = ctx

  const reflectStoreId = sessionId ? await getSessionReflectStoreId(sessionId) : null
  if (reflectStoreId) {
    registerReflectTools(server, workspaceId, reflectStoreId)
    return
  }

  registerMemoryTools(server, workspaceId)
  registerAgentTools(server, workspaceId, taskId)
  registerBrowserTools(server, workspaceId)
  registerSandboxTools(server, workspaceId)
  registerSkillsTools(server, workspaceId)
  registerAfsTools(server, workspaceId)
  registerExportFileUrlTool(server, workspaceId)
  registerBuilderTools(server, workspaceId, headers)
}
