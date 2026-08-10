import { dropRemoteProxy, ensureRemoteProxy, syncReplicaProxies } from '../lib/remote-proxy'
import { type WorkspaceStatus, applyStatusChange } from '../lib/workspace-status'
import {
  type WorkspaceObservation,
  listReapableWorkspaces,
  listWorkspaceObservations,
  markStaleEnvironmentsOffline,
} from './db/environments'
import { deleteWorkspace, updateWorkspace } from './db/workspaces'

// Status projection. A workspace's status is derived from what its runner
// reports into workspace_placements — one path for every environment kind and
// every workload shape, because every runner writes the same columns. cp reads
// no infrastructure of its own here.
//
// For a remote environment the report is qualified by the runner's heartbeat: a
// stale heartbeat makes the environment offline and its workspaces 'unknown',
// since cp then has no basis for a better answer. The pass also keeps the
// forward data-plane proxies in step for those workspaces.

/**
 * Map a reported phase onto the status the API exposes.
 *
 * The 'unknown' / null case is the one that depends on where the workspace runs.
 * It means nothing is provisioned, which on the built-in environment is
 * unambiguous — the workspace is simply not up, so 'stopped'. On a remote
 * environment the same report may instead mean the runner cannot see its own
 * cluster, so 'unknown' is the honest answer.
 */
function mapObservedToStatus(phase: string | null, isBuiltin: boolean): WorkspaceStatus {
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
      return isBuiltin ? 'stopped' : 'unknown'
  }
}

/**
 * Forward proxy lifecycle for a remote workspace: a reachable, running one gets
 * a localhost proxy so cp's fetch sites can reach it through the tunnel;
 * anything else has none. A workspace reporting a ready-replica set gets one
 * proxy per ready ordinal, one reporting none gets the single ordinal-less
 * proxy. Built-in workspaces are reached over cluster DNS and never take part.
 */
async function reconcileProxy(o: WorkspaceObservation, status: WorkspaceStatus): Promise<void> {
  if (o.is_builtin) return
  if (o.env_offline || status !== 'running') {
    dropRemoteProxy(o.workspace_id)
    return
  }
  if (o.ready_replica_ids && o.ready_replica_ids.length > 0) {
    await syncReplicaProxies(o.workspace_id, o.environment_id, o.ready_replica_ids)
  } else {
    await ensureRemoteProxy(o.workspace_id, o.environment_id)
  }
}

/**
 * One projection pass: mark stale environments offline, reap confirmed deletes,
 * then project every placed workspace's status and reconcile its proxy.
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

  for (const o of await listWorkspaceObservations(thresholdSec)) {
    const status: WorkspaceStatus = o.env_offline
      ? 'unknown'
      : mapObservedToStatus(o.observed_phase, o.is_builtin)

    if (o.status !== status) {
      await applyStatusChange(o.workspace_id, status, o.status)
    }

    // Cache the running pod-template version so "rebuild available" is a pure DB
    // comparison. Only when one was reported — a stopped workspace has no
    // workload to read it from, and its last known version is still the truth.
    const reported = o.observed_template_version
    if (reported !== null && reported !== o.runtime_version) {
      await updateWorkspace(o.workspace_id, { runtime_version: reported })
    }

    await reconcileProxy(o, status)
  }
}
