import { notifyAgentReload } from '../lib/workspace-address'
import { listWorkspacesUsingPrompt } from './db/workspaces'

/**
 * Push a `config` reload to every running workspace whose system prompt
 * resolves through this prompt id. Called after a prompt's content / name /
 * visibility / version changes so those workspaces re-pull the new value.
 *
 * Shared by the REST prompt routes and the builder-mode prompt library
 * actions so the two write paths can't drift on which downstream notify.
 */
export async function reloadWorkspacesUsingPrompt(promptId: string): Promise<void> {
  const workspaces = await listWorkspacesUsingPrompt(promptId, true)
  await Promise.all(workspaces.map((w) => notifyAgentReload(w.id, ['config'])))
}
