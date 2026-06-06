import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  commandCreateAction,
  commandDeleteAction,
  commandSetDisabledAction,
  commandUpdateAction,
} from './actions/command'
import { configUpdateAction, promptSetAction } from './actions/config'
import {
  scheduleCreateAction,
  scheduleDeleteAction,
  scheduleUpdateAction,
} from './actions/schedule'
import { skillDisableAction, skillEnableAction } from './actions/skill'
import { registerBuilderAction } from './define-action'

/**
 * `workspace` cap tools: shape the current workspace's own resources.
 *
 * Each entry is a Builder Mode action descriptor — `registerBuilderAction`
 * expands it into a `*_propose` + `*_apply` MCP tool pair that shares one
 * zod schema for the agent_request payload, so the type contract is
 * enforced at compile time across both tools.
 */
export function registerWorkspaceCapTools(server: McpServer, workspaceId: string): void {
  registerBuilderAction(server, workspaceId, scheduleCreateAction)
  registerBuilderAction(server, workspaceId, scheduleUpdateAction)
  registerBuilderAction(server, workspaceId, scheduleDeleteAction)
  registerBuilderAction(server, workspaceId, commandCreateAction)
  registerBuilderAction(server, workspaceId, commandUpdateAction)
  registerBuilderAction(server, workspaceId, commandDeleteAction)
  registerBuilderAction(server, workspaceId, commandSetDisabledAction)
  registerBuilderAction(server, workspaceId, skillEnableAction)
  registerBuilderAction(server, workspaceId, skillDisableAction)
  registerBuilderAction(server, workspaceId, configUpdateAction)
  registerBuilderAction(server, workspaceId, promptSetAction)
}
