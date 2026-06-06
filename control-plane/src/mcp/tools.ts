import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerAfsTools } from './tools/afs'
import { registerAgentTools } from './tools/agent'
import { registerBrowserTools } from './tools/browser'
import { registerBuilderTools } from './tools/builder-mode'
import { registerExportFileUrlTool } from './tools/export-file-url'
import { registerMemoryTools } from './tools/memory'
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
 */
export function registerTools(server: McpServer, ctx: McpRequestContext) {
  const { workspaceId, taskId, headers } = ctx
  registerMemoryTools(server, workspaceId)
  registerAgentTools(server, workspaceId, taskId)
  registerBrowserTools(server, workspaceId)
  registerSandboxTools(server, workspaceId)
  registerSkillsTools(server, workspaceId)
  registerAfsTools(server, workspaceId)
  registerExportFileUrlTool(server, workspaceId)
  registerBuilderTools(server, workspaceId, headers)
}
