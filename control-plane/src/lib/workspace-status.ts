import { resetAllSessionsIdle } from '../services/db/sessions'
import { updateWorkspace } from '../services/db/workspaces'

// The set of statuses cp projects onto a workspace. The first four come from the
// built-in k8s reconcile (ReconciledStatus); 'unknown' is added by the remote
// projection when an environment goes offline (design §5.3) and 'pending' is
// used by some create paths.
export type WorkspaceStatus = 'running' | 'stopped' | 'starting' | 'error' | 'pending' | 'unknown'

/**
 * Apply a status transition to a workspace: write it (skipping no-ops) and reset
 * stale chat sessions when the agent is no longer reachable. Shared by the
 * built-in watch-k8s reconcile and the remote projection so both treat status
 * changes identically.
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
