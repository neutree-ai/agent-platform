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
import { drainAfterStop, drainBeforeDelete } from './usage/teardown'

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
  // Interrupting is the last thing that can add to the transcripts, so the wait
  // for them to settle starts here. Detached — see drainAfterStop.
  const settleFrom = Date.now()
  await setDesiredPhase(workspace.id, 'stopped')
  await resetAllSessionsIdle(workspace.id)
  await updateWorkspace(workspace.id, { status: 'stopped' })
  drainAfterStop(workspace.id, workspace.user_id, settleFrom)
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
 * Its usage is collected first, because both exits below put the transcripts
 * out of reach — see drainBeforeDelete, which is also what `force` overrides.
 *
 * Shared by the owner delete route and the admin fleet view.
 */
export async function destroyWorkspace(workspace: Workspace, force = false): Promise<void> {
  await interruptAllSessions(workspace, 'Delete')
  const settleFrom = Date.now()

  for (const s of await listSchedulesByWorkspace(workspace.id)) {
    await jobs.cancelScheduleTimer(s).catch(() => {})
  }

  await fireDeleteHooks(workspace.id)

  // Before either teardown path, and after the work above — which the settle
  // wait absorbs rather than adds to.
  await drainBeforeDelete(workspace, settleFrom, force)

  const placementEnv = await getWorkspacePlacementEnv(workspace.id)
  if (placementEnv && !placementEnv.isBuiltin) {
    await setDesiredPhase(workspace.id, 'deleted')
    await updateWorkspace(workspace.id, { status: 'deleting' })
    return
  }

  // Removes both workload shapes: the row and its placement go next, so the
  // runner's reconcile never sees this workspace again to clean up after.
  await k8s.destroy(workspace.id)
  await deleteWorkspace(workspace.id)
}
