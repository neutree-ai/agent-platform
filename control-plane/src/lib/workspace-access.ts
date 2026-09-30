// Who may act on a workspace.
//
// Two levels:
//   - access: use and manage the workspace — chat in any session, edit its
//     configuration, start / stop it, read its files. The owner has it, and so
//     does every member of a team the owner shared the workspace with.
//   - owner: delete, transfer, change visibility, save as template, and share /
//     revoke. Only the owner.
//
// The agent always runs as the owner, whoever is talking to it: credentials,
// MCP tokens, providers and usage all resolve through `workspaces.user_id`.
// Access checks must therefore never be used to pick an identity.

import type { Workspace } from '../services/db/types'
import { isWorkspaceSharedWithUser } from '../services/db/workspace-shares'
import { getWorkspace } from '../services/db/workspaces'

type Caller = { sub: string; role: string }

export function isWorkspaceOwner(workspace: Workspace, user: Caller): boolean {
  return workspace.user_id === user.sub
}

/**
 * Owner-level check that also admits admins on system workspaces, which no
 * user owns. For the routes that stay with the owner on user workspaces but
 * must remain operable on system ones.
 */
export function canOwn(workspace: Workspace, user: Caller): boolean {
  return isWorkspaceOwner(workspace, user) || (workspace.is_system && user.role === 'admin')
}

export async function canAccessWorkspace(workspace: Workspace, user: Caller): Promise<boolean> {
  if (canOwn(workspace, user)) return true
  if (workspace.is_system) return false
  return isWorkspaceSharedWithUser(workspace.id, user.sub)
}

/**
 * Whose resources a picker should list. Resources attached to a workspace are
 * used as its owner, so when a caller edits a workspace — possibly one shared
 * with them — the candidates are the owner's, not the caller's. Without a
 * workspace, the caller's own. Null when the caller cannot access the
 * workspace.
 */
export async function resolveResourceViewer(
  user: Caller,
  workspaceId: string | undefined,
): Promise<string | null> {
  if (!workspaceId) return user.sub
  const workspace = await getWorkspace(workspaceId)
  if (!workspace || !(await canAccessWorkspace(workspace, user))) return null
  return workspace.user_id
}
