/**
 * Plugin bootstrap — registered once at app startup.
 *
 * Each plugin owns its own refresh signal and exports a public bump/useToken
 * API; the agent-session store dispatches tool_result events to whichever
 * handlers match.
 */

import { agentRequestProposeRenderer } from '@/components/chat/tool-renderers/mcp/agent-request'
import { registerToolRenderer } from '@neutree-ai/ui-sdk'
import { builderModePlugin } from './builder-mode'
import { filesPlugin } from './files'
import { memoryPlugin } from './memory'
import { registerPlugin } from './registry'
import { skillsPlugin } from './skills'

// Builder Mode propose tools render an interactive Approve/Reject card that
// reaches into app state, so the renderer stays app-side and registers into
// the UI SDK's tool-renderer registry here rather than being bundled in it.
const AGENT_REQUEST_PROPOSE_TOOLS = [
  'workspace_schedule_propose',
  'workspace_schedule_update_propose',
  'workspace_schedule_delete_propose',
  'workspace_command_propose',
  'workspace_command_update_propose',
  'workspace_command_delete_propose',
  'workspace_skill_enable_propose',
  'workspace_skill_disable_propose',
  'workspace_config_propose',
  'workspace_prompt_propose',
  'prompt_create_propose',
  'prompt_update_propose',
  'prompt_delete_propose',
]

let registered = false

export function registerBuiltinPlugins(): void {
  if (registered) return
  registered = true
  registerPlugin(filesPlugin)
  registerPlugin(memoryPlugin)
  registerPlugin(skillsPlugin)
  registerPlugin(builderModePlugin)
  for (const name of AGENT_REQUEST_PROPOSE_TOOLS) {
    registerToolRenderer(name, agentRequestProposeRenderer)
  }
}
