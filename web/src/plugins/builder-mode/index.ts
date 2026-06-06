/**
 * Builder-mode plugin — owns refresh signals for the resources that the
 * agent can mutate through `*_apply` tools.
 *
 * Each resource exposes a bump/useToken pair. Panels subscribe via their
 * useToken and invalidate the matching react-query keys when it changes.
 * Plugin handlers fire on the apply tool *result* (not propose), so a
 * mutation card that never gets approved won't trigger a refresh.
 */

import type { WorkspacePlugin } from '@/plugins/types'
import { create } from 'zustand'

interface TokenState {
  token: number
  bump: () => void
}

function makeRefresh(): {
  bump: () => void
  useToken: () => number
} {
  const useStore = create<TokenState>((set) => ({
    token: 0,
    bump: () => set((s) => ({ token: s.token + 1 })),
  }))
  return {
    bump: () => useStore.getState().bump(),
    useToken: () => useStore((s) => s.token),
  }
}

// One token per panel-scoped data domain. Add a new entry here when wiring a
// new builder-mode action whose UI lives outside the existing panels.
export const schedulesRefresh = makeRefresh()
export const commandsRefresh = makeRefresh()
export const workspaceConfigRefresh = makeRefresh()
export const promptLibraryRefresh = makeRefresh()

// MCP-namespaced names arrive as e.g. `mcp__tos-platform__workspace_schedule_apply`.
// Anchor on word boundaries so partial matches don't slip through.
const matchApply = (resourcePrefix: string) =>
  new RegExp(
    `(?:^|[./:_-])${resourcePrefix}(?:_(?:update|delete|enable|disable))?_apply(?:$|[./:_-])`,
    'i',
  )

const scheduleApply = matchApply('workspace_schedule')
const commandApply = matchApply('workspace_command')
const configApply = /(?:^|[./:_-])workspace_(?:config|prompt)_apply(?:$|[./:_-])/i
const promptLibraryApply = /(?:^|[./:_-])prompt_(?:create|update|delete)_apply(?:$|[./:_-])/i

export const builderModePlugin: WorkspacePlugin = {
  id: 'builder-mode',
  toolResultHandlers: [
    {
      id: 'builder-mode.schedule',
      match: ({ toolName }) => scheduleApply.test(toolName),
      onMatch: () => schedulesRefresh.bump(),
    },
    {
      id: 'builder-mode.command',
      match: ({ toolName }) => commandApply.test(toolName),
      onMatch: () => commandsRefresh.bump(),
    },
    {
      id: 'builder-mode.workspace-config',
      match: ({ toolName }) => configApply.test(toolName),
      onMatch: () => workspaceConfigRefresh.bump(),
    },
    {
      id: 'builder-mode.prompt-library',
      match: ({ toolName }) => promptLibraryApply.test(toolName),
      onMatch: () => promptLibraryRefresh.bump(),
    },
  ],
}
