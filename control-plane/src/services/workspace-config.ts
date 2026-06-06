import { notifyAgentReload } from '../lib/workspace-address'
import { getWorkspace, updateWorkspace, updateWorkspaceConfig } from './db/workspaces'
import { reconcileWorkspacePod } from './workspace-reconcile'

type WorkspaceConfigPatch = Parameters<typeof updateWorkspaceConfig>[1]

/**
 * Update a workspace's agent config and propagate the right downstream
 * effect: container rebuild when `agent_type` changes to a different image,
 * or a hot `config` reload otherwise (only for running workspaces).
 *
 * Used by both the REST entry (`PUT /workspaces/:id/config` and the
 * internal variant) and the builder-mode `workspace_config` / `workspace_prompt`
 * actions. Compute-resource changes stay inline in the routes — they only
 * apply to the user-facing path.
 */
export async function applyWorkspaceConfigUpdate(
  workspaceId: string,
  patch: WorkspaceConfigPatch,
): Promise<{ rebuilt: boolean; reloaded: boolean }> {
  const workspace = await getWorkspace(workspaceId)
  if (!workspace) throw new Error('workspace not found')

  await updateWorkspaceConfig(workspaceId, patch)

  const running = workspace.status === 'running'
  if (!running) return { rebuilt: false, reloaded: false }

  const reconciled = await reconcileWorkspacePod(workspaceId)
  if (reconciled.rebuilt) {
    console.log(`[config ${workspaceId}] rebuilt: ${reconciled.reason}`)
    await updateWorkspace(workspaceId, { status: 'starting' })
    return { rebuilt: true, reloaded: false }
  }

  const reloaded = await notifyAgentReload(workspaceId, ['config']).catch(() => false)
  return { rebuilt: false, reloaded }
}
