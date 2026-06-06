import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { parseBuilderHeader } from '../../../../../internal/types/builder'
import { registerGlobalCapTools } from './global.js'
import { registerBuilderReadTools } from './read.js'
import { registerWorkspaceCapTools } from './workspace.js'

/**
 * Builder mode dispatcher. Agents opt into capability subsets via the
 * `X-Builder` header on the `tos-platform` MCP entry in mcp_config; the
 * dispatcher passes the request `Headers` through here. Unknown caps are
 * silently dropped (see `parseBuilderHeader`); when no cap is enabled at
 * all, no builder tools are registered — including the common read tools.
 */
export function registerBuilderTools(
  server: McpServer,
  workspaceId: string,
  headers: Headers,
): void {
  const caps = parseBuilderHeader(headers.get('x-builder'))
  if (caps.length === 0) return

  // Common reads (list_prompts, get_prompt, ...) are available whenever any
  // cap is on — they provide context for `*_propose` tools without requiring
  // a specific mutation cap.
  registerBuilderReadTools(server, workspaceId)

  for (const cap of caps) {
    switch (cap) {
      case 'workspace':
        registerWorkspaceCapTools(server, workspaceId)
        break
      case 'global':
        registerGlobalCapTools(server, workspaceId)
        break
    }
  }
}
