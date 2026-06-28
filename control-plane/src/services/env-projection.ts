import { dropRemoteProxy, ensureRemoteProxy } from '../lib/remote-proxy'
import { type WorkspaceStatus, applyStatusChange } from '../lib/workspace-status'
import {
  listReapableWorkspaces,
  listRemoteWorkspaceObservations,
  markStaleEnvironmentsOffline,
} from './db/environments'
import { deleteWorkspace, getWorkspace } from './db/workspaces'

// Remote environment projection (design §5.3, §7). cp can't watch a remote
// cluster's k8s, so a remote workspace's status is derived from what its runner
// reports (observed_phase) plus the environment's heartbeat: a stale heartbeat
// makes the environment offline and its workspaces 'unknown'. This is the remote
// counterpart of the built-in watch-k8s reconcile. It also keeps the forward
// data-plane proxies in step — created when a remote workspace is reachable,
// dropped otherwise.

function mapObservedToStatus(phase: string | null): WorkspaceStatus {
  switch (phase) {
    case 'running':
      return 'running'
    case 'stopped':
      return 'stopped'
    case 'error':
      return 'error'
    case 'pending':
    case 'starting':
      return 'starting'
    default:
      return 'unknown'
  }
}

/**
 * One projection pass: mark stale environments offline, then for each remote
 * workspace derive its status and reconcile its forward proxy. Cheap no-op when
 * there are no remote environments.
 */
export async function runEnvProjection(thresholdSec: number): Promise<void> {
  const offlined = await markStaleEnvironmentsOffline(thresholdSec)
  if (offlined.length > 0) {
    console.log(`[EnvProjection] environments offline (stale heartbeat): ${offlined.join(', ')}`)
  }

  // Reap inverted remote deletes: the runner has destroyed the pod and removed
  // the placement, so finalize the workspace row (CASCADE-removes config /
  // sessions / schedules). Delete hooks already fired at the delete request.
  for (const wsId of await listReapableWorkspaces()) {
    dropRemoteProxy(wsId)
    await deleteWorkspace(wsId)
    console.log(`[EnvProjection] reaped deleted workspace ${wsId}`)
  }

  const observations = await listRemoteWorkspaceObservations(thresholdSec)
  for (const o of observations) {
    const status: WorkspaceStatus = o.env_offline
      ? 'unknown'
      : mapObservedToStatus(o.observed_phase)

    const ws = await getWorkspace(o.workspace_id)
    if (ws && ws.status !== status) {
      await applyStatusChange(o.workspace_id, status, ws.status)
    }

    // Forward proxy lifecycle: a reachable, running remote workspace gets a
    // localhost proxy so cp's fetch sites can reach it through the tunnel;
    // anything else (stopped/starting/offline) has none.
    if (!o.env_offline && status === 'running') {
      await ensureRemoteProxy(o.workspace_id, o.environment_id)
    } else {
      dropRemoteProxy(o.workspace_id)
    }
  }
}
