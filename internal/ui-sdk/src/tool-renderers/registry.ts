import { transcriptI18n as i18n } from '../i18n'
import { getPluginToolRenderer } from '../tool-renderers/plugin-registry'
import type { ToolRendererDef } from './types'

// Claude Code built-in tools
import { agentRenderer } from './claude/agent'
import { bashRenderer } from './claude/bash'
import { fileEditRenderer } from './claude/file-edit'
import { fileReadRenderer } from './claude/file-read'
import { globRenderer, grepRenderer } from './claude/search'
import { taskReadRenderer, taskWriteRenderer } from './claude/task'
import { todoRenderer } from './claude/todo'
import { webFetchRenderer, webSearchRenderer } from './claude/web'

import { grantAccessRenderer, shareFolderRenderer, unshareFromAllRenderer } from './mcp/afs'
// Platform MCP tools (shared across agents)
import { callAgentRenderer, getAgentResultRenderer } from './mcp/agent'
import { createBrowserRenderer, deleteBrowserRenderer, listBrowsersRenderer } from './mcp/browser'
import { builderReadRenderer } from './mcp/builder-read'
import { exportFileUrlRenderer } from './mcp/export'
import { readMemoryRenderer, updateMemoryRenderer } from './mcp/memory'
import {
  createSandboxRenderer,
  killSandboxRenderer,
  listSandboxesRenderer,
  sandboxGetPreviewUrlRenderer,
  sandboxReadFileRenderer,
  sandboxRunCommandRenderer,
  sandboxWriteFilesRenderer,
} from './mcp/sandbox'
import {
  skillCreateDraftRenderer,
  skillEnterEditRenderer,
  skillPublishRenderer,
} from './mcp/skills'

// Agent-type fallbacks
import { claudeFallback } from './fallbacks/claude-fallback'
import { codexFallback } from './fallbacks/codex-fallback'

// Codex built-in tools with static names
import { codexWebSearchRenderer } from './codex/web-search'

// ── Tool-name registry (priority 1) ──

const toolRenderers: Record<string, ToolRendererDef> = {
  // Claude Code
  Bash: bashRenderer,
  Read: fileReadRenderer,
  Edit: fileEditRenderer,
  Write: fileEditRenderer,
  Glob: globRenderer,
  Grep: grepRenderer,
  WebFetch: webFetchRenderer,
  WebSearch: webSearchRenderer,
  TodoWrite: todoRenderer, // legacy: persisted transcripts before SDK 0.3.142
  // SDK 0.3.142+ task tools (per-task calls, replace TodoWrite)
  TaskCreate: taskWriteRenderer,
  TaskUpdate: taskWriteRenderer,
  TaskList: taskReadRenderer,
  TaskGet: taskReadRenderer,
  Agent: agentRenderer,
  Task: agentRenderer,

  // MCP tools (shared across agents)
  read_memory: readMemoryRenderer,
  update_memory: updateMemoryRenderer,

  // Sandbox
  create_sandbox: createSandboxRenderer,
  list_sandboxes: listSandboxesRenderer,
  sandbox_run_command: sandboxRunCommandRenderer,
  sandbox_read_file: sandboxReadFileRenderer,
  sandbox_write_files: sandboxWriteFilesRenderer,
  sandbox_get_preview_url: sandboxGetPreviewUrlRenderer,
  kill_sandbox: killSandboxRenderer,

  // Browser
  create_browser: createBrowserRenderer,
  list_browsers: listBrowsersRenderer,
  delete_browser: deleteBrowserRenderer,

  // Agent (MCP)
  call_agent: callAgentRenderer,
  get_agent_result: getAgentResultRenderer,

  // Skills
  skill_create_draft: skillCreateDraftRenderer,
  skill_enter_edit: skillEnterEditRenderer,
  skill_publish: skillPublishRenderer,

  // AFS shared folders
  share_folder: shareFolderRenderer,
  grant_access: grantAccessRenderer,
  unshare_from_all: unshareFromAllRenderer,

  // Export file URL
  export_file_url: exportFileUrlRenderer,

  // NOTE: the Builder Mode *_propose tools (workspace_*_propose,
  // prompt_*_propose) carry an interactive Approve/Reject card that reaches
  // into app state, so their renderer is not bundled here — the host app
  // registers it via registerToolRenderer() at boot.

  // Builder Mode — read tools (all share one plain-text renderer)
  list_prompts: builderReadRenderer,
  get_prompt: builderReadRenderer,
  list_schedules: builderReadRenderer,
  list_commands: builderReadRenderer,
  get_command: builderReadRenderer,
  list_skills: builderReadRenderer,
  get_skill: builderReadRenderer,
  list_providers: builderReadRenderer,
  get_workspace_config: builderReadRenderer,

  // Codex built-in (static title)
  'Searching the Web': codexWebSearchRenderer,
}

// ── Agent-type fallback registry (priority 2) ──

const agentFallbacks: Record<string, ToolRendererDef> = {
  'claude-code': claudeFallback,
  codex: codexFallback,
  opencode: codexFallback,
}

// ── Public API ──

/**
 * Strip tool name prefixes to get the canonical display name.
 * Handles:
 *  - CC MCP format:    mcp__server__tool_name → tool_name
 *  - Codex MCP format: Tool: server/tool_name → tool_name
 */
export function getToolDisplayName(name: string | null | undefined): string {
  if (!name) return i18n.t('components.chat.toolRenderers.labels.unknown')
  // CC MCP: mcp__server__tool_name
  const mcpMatch = name.match(/^mcp__(.+?)__(.+)$/)
  if (mcpMatch) return mcpMatch[2]
  // Codex MCP: Tool: server/tool_name
  const codexMcpMatch = name.match(/^Tool:\s*.+\/(.+)$/)
  if (codexMcpMatch) return codexMcpMatch[1]
  return name
}

/**
 * Codex dispatches MCP calls as a literal `execute` tool_call carrying the
 * real target at `input.tool` (paired with `input.server` / `input.arguments`
 * — the same shape `unwrapMcpInput` unwraps for renderer input access).
 * Renderer lookup needs the real tool name, not the `execute` wrapper name.
 */
export function unwrapExecuteDispatchName(name: string, input: unknown): string {
  if (name !== 'execute' || typeof input !== 'object' || input === null) return name
  const record = input as Record<string, unknown>
  return typeof record.tool === 'string' && record.server ? record.tool : name
}

/**
 * Resolve the best renderer for a tool call.
 * 1. Built-in exact tool-name match (after stripping prefixes)
 * 2. Plugin-registered renderer (window.tos.registerToolRenderer)
 * 3. Agent-type fallback
 * 4. null (caller uses DefaultInput/DefaultResult)
 */
export function resolveRenderer(
  tool: { name: string; input?: unknown },
  agentType: string,
): ToolRendererDef | null {
  const displayName = getToolDisplayName(unwrapExecuteDispatchName(tool.name, tool.input))
  return (
    toolRenderers[displayName] ??
    getPluginToolRenderer(displayName) ??
    agentFallbacks[agentType] ??
    null
  )
}
