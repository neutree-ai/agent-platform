/**
 * Skills plugin — owns the "skills directory has changed" refresh signal.
 *
 * Bumps when the agent calls one of the skill-management MCP tools
 * (skill_create_draft / skill_enter_edit / skill_publish). Subscribed to by
 * WorkspaceSkillsPanel for both the skill list and the open skill's file
 * tree.
 */

import type { WorkspacePlugin } from '@/plugins/types'
import { create } from 'zustand'

interface SkillsRefreshState {
  token: number
  bump: () => void
}

const useSkillsStore = create<SkillsRefreshState>((set) => ({
  token: 0,
  bump: () => set((s) => ({ token: s.token + 1 })),
}))

export const skillsRefresh = {
  bump: () => useSkillsStore.getState().bump(),
  useToken: () => useSkillsStore((s) => s.token),
}

const skillToolPattern =
  /(?:^|[./:_-])(skill_create_draft|skill_enter_edit|skill_publish)(?:$|[./:_-])/i

// Builder-mode workspace_skill_(enable|disable)_apply changes which skills
// are attached to the workspace — same `workspace-skills` query as the
// authoring lifecycle, so we reuse the same bump.
const workspaceSkillApplyPattern =
  /(?:^|[./:_-])workspace_skill_(?:enable|disable)_apply(?:$|[./:_-])/i

export const skillsPlugin: WorkspacePlugin = {
  id: 'skills',
  toolResultHandlers: [
    {
      id: 'skills.lifecycle',
      match: ({ toolName }) => skillToolPattern.test(toolName),
      onMatch: () => skillsRefresh.bump(),
    },
    {
      id: 'skills.workspace-attach',
      match: ({ toolName }) => workspaceSkillApplyPattern.test(toolName),
      onMatch: () => skillsRefresh.bump(),
    },
  ],
}
