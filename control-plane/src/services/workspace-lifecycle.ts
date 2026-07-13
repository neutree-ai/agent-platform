import * as jobs from '../lib/jobs'
import { fireDeleteHooks } from '../lib/service-hooks'
import { interruptAllSessions } from '../routes/workspaces/_shared'
import { getWorkspacePlacementEnv } from './db/environments'
import { listSchedulesByWorkspace } from './db/schedules'
import { resetAllSessionsIdle } from './db/sessions'
import type { Workspace } from './db/types'
import { deleteWorkspace, updateWorkspace } from './db/workspaces'
import * as k8s from './k8s'
import { setDesiredPhase } from './placement'

/**
 * Stop a workspace: interrupt active sessions, record desired=stopped (the
 * env-runner scales the deployment down), reset session idle state, and mark
 * the row stopped. Reversible — the workspace auto-starts on next chat/trigger.
 *
 * Shared by the owner stop route and the admin fleet view — the only difference
 * between them is the authorization check the caller performs first.
 */
export async function stopWorkspace(workspace: Workspace): Promise<void> {
  await interruptAllSessions(workspace, 'Stop')
  await setDesiredPhase(workspace.id, 'stopped')
  await resetAllSessionsIdle(workspace.id)
  await updateWorkspace(workspace.id, { status: 'stopped' })
}

/**
 * Delete a workspace and tear down its instance. Interrupts running sessions,
 * unregisters pg-boss schedule timers before the CASCADE removes the rows
 * (otherwise cron registrations / one-time jobs leak in pg-boss), and fires the
 * delete hooks.
 *
 * Remote (non-builtin) environments invert control: cp can't reach the cluster
 * to tear the pod down, and deleting the row now would CASCADE away the
 * placement before the runner sees desired=deleted (orphan pod). So mark
 * desired=deleted + status=deleting and let the runner reap the row via env
 * projection. Built-in environments delete the k8s instance and the row
 * synchronously.
 *
 * Shared by the owner delete route and the admin fleet view.
 */
export async function destroyWorkspace(workspace: Workspace): Promise<void> {
  await interruptAllSessions(workspace, 'Delete')

  for (const s of await listSchedulesByWorkspace(workspace.id)) {
    await jobs.cancelScheduleTimer(s).catch(() => {})
  }

  await fireDeleteHooks(workspace.id)

  const placementEnv = await getWorkspacePlacementEnv(workspace.id)
  if (placementEnv && !placementEnv.isBuiltin) {
    await setDesiredPhase(workspace.id, 'deleted')
    await updateWorkspace(workspace.id, { status: 'deleting' })
    return
  }

  await k8s.deleteInstance(workspace.id)
  await deleteWorkspace(workspace.id)
}
