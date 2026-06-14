/**
 * Workspace plugin contract.
 *
 * Plugins extend the workspace with side-effects on tool completions. The
 * agent-session store owns no business-specific state; instead it dispatches
 * tool_result events to plugin-registered handlers, and each plugin owns its
 * own refresh signal (typically a small zustand store with a bump counter).
 *
 * To let third parties trigger a plugin's refresh, the plugin should export
 * a public `bump`/`useToken` API alongside its handlers.
 */

export interface ToolMatchCtx {
  /** Tool name as it arrives on the SSE stream — may be bare ("Edit"),
   *  prefixed with an argument ("Edit /path", "Run pwd") or namespaced
   *  ("mcp__tos-platform__share_folder"). Plugins should match leniently. */
  toolName: string
  toolInput: Record<string, unknown>
  toolOutput: string
  isError: boolean
  callId: string
  workspaceId: string
}

export interface ToolResultHandler {
  /** Stable id for debugging / debounce keying. Convention: `<plugin>.<purpose>`. */
  id: string
  match: (ctx: ToolMatchCtx) => boolean
  /** Coalesce rapid matches so onMatch fires once after this quiet window. */
  debounceMs?: number
  onMatch: (ctx: ToolMatchCtx) => void
}

import type { PluginPanel } from '@/lib/panel-registry'

export interface WorkspacePlugin {
  id: string
  toolResultHandlers?: ToolResultHandler[]
  /** Tabs the plugin contributes to the workspace view. The panel `id` must
   *  match a panel declared in the plugin's manifest (`owns.panels`, or the
   *  eager-plugin ui_panel fallback); the tab shows when the plugin is
   *  installed in the workspace — independent of any MCP server. */
  panels?: PluginPanel[]
}
