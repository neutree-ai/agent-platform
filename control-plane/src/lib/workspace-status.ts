import { resetAllSessionsIdle } from '../services/db/sessions'
import { updateWorkspace } from '../services/db/workspaces'

// The set of statuses cp projects onto a workspace. Most are mapped from the
// phase its runner reports; 'unknown' is what a remote environment's workspaces
// become when that environment goes offline and cp has no basis for a better
// answer, and 'pending' is used by some create paths.
export type WorkspaceStatus = 'running' | 'stopped' | 'starting' | 'error' | 'pending' | 'unknown'

/**
 * Apply a status transition to a workspace: write it (skipping no-ops) and reset
 * stale chat sessions when the agent is no longer reachable. The single place a
 * workspace's status changes, so every transition is treated identically.
 */
export async function applyStatusChange(
  workspaceId: string,
  resolved: WorkspaceStatus,
  dbStatus?: string,
): Promise<void> {
  if (dbStatus !== undefined && resolved === dbStatus) return

  await updateWorkspace(workspaceId, { status: resolved })
  console.log(`[Reconcile] workspace=${workspaceId} ${dbStatus ?? '?'} → ${resolved}`)

  // Reset stale chat_status when the agent can't be serving: stopped/error, and
  // 'unknown' (remote environment offline — the agent is unreachable).
  if (resolved === 'stopped' || resolved === 'error' || resolved === 'unknown') {
    await resetAllSessionsIdle(workspaceId)
  }
}
