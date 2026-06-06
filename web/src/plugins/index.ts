/**
 * Plugin bootstrap — registered once at app startup.
 *
 * Each plugin owns its own refresh signal and exports a public bump/useToken
 * API; the agent-session store dispatches tool_result events to whichever
 * handlers match.
 */

import { builderModePlugin } from './builder-mode'
import { filesPlugin } from './files'
import { memoryPlugin } from './memory'
import { registerPlugin } from './registry'
import { skillsPlugin } from './skills'

let registered = false

export function registerBuiltinPlugins(): void {
  if (registered) return
  registered = true
  registerPlugin(filesPlugin)
  registerPlugin(memoryPlugin)
  registerPlugin(skillsPlugin)
  registerPlugin(builderModePlugin)
}
