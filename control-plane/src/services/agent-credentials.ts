// The credential payload an agent receives for its workspace.
//
// Shared by the authenticated /ws/v1 route and the unauthenticated /_cp one it
// replaces. Those two are served side by side only until every workspace has
// been rebuilt with a token, and a copy of this logic per route would have
// drifted in exactly that window.

import type { ApiCredential } from '../../../internal/types/api'
import { listWorkspaceCredentials } from './db/credentials'
import { getWorkspace } from './db/workspaces'

/**
 * Credentials applicable to a workspace, values included — the agent injects
 * them, so this is the one place they leave cp in plaintext.
 *
 * Null when the workspace does not exist, which callers report as 404.
 */
export async function credentialsForWorkspace(
  workspaceId: string,
): Promise<ApiCredential[] | null> {
  const workspace = await getWorkspace(workspaceId)
  if (!workspace) return null

  const creds = await listWorkspaceCredentials(workspaceId, workspace.user_id)
  return creds.map((cr) => ({
    name: cr.name,
    value: cr.value,
    inject: cr.inject,
    path: cr.path,
    mode: cr.mode,
    scope: cr.scope,
    status: cr.status,
  }))
}
