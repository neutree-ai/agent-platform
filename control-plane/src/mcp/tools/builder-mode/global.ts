import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  promptLibraryCreateAction,
  promptLibraryDeleteAction,
  promptLibraryUpdateAction,
} from './actions/prompt'
import { registerBuilderAction } from './define-action'

/**
 * `global` cap: tools that touch account-wide resources spanning workspaces —
 * credentials, providers, prompt lib, shares. Same patch-envelope contract
 * as the workspace cap; the web side renders Approve/Reject.
 *
 * Tool names drop the `workspace_` prefix (scope: 'global' on the action
 * descriptor) since these resources aren't owned by a workspace.
 */
export function registerGlobalCapTools(server: McpServer, workspaceId: string): void {
  registerBuilderAction(server, workspaceId, promptLibraryCreateAction)
  registerBuilderAction(server, workspaceId, promptLibraryUpdateAction)
  registerBuilderAction(server, workspaceId, promptLibraryDeleteAction)
}
