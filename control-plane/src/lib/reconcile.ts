import { Cron } from 'croner'
import { reloadUserWorkspaces } from '../routes/credentials'
import {
  hardDeleteUserCredentials,
  listAllUserCredentials,
  listUsersWithDeletingCredentials,
} from '../services/db/credentials'
import { getRemoteWorkspaceIds } from '../services/db/environments'
import { getWorkspace, listAllWorkspaces, updateWorkspace } from '../services/db/workspaces'
import { runEnvProjection } from '../services/env-projection'
import { runIdleWorkspaceGC } from '../services/idle-workspace-gc'
import * as k8s from '../services/k8s'
import { sweepRunningWorkspaces } from '../services/usage/pull'
import { applyStatusChange } from './workspace-status'

const WATCH_CYCLE_MS = 10 * 60 * 1000 // 10 minutes

// How often to project remote placements → workspaces.status, and how long
// without a runner heartbeat before an environment is considered offline.
const ENV_PROJECTION_INTERVAL = '*/15 * * * * *'
const ENV_HEARTBEAT_TIMEOUT_SEC = Number(process.env.ENV_HEARTBEAT_TIMEOUT_SEC) || 60

/**
 * Full list reconcile: fetch all workspaces from DB and all deployments from
 * K8s, compare and update. Returns the resourceVersion for starting a watch.
 */
async function fullReconcile(): Promise<string> {
  const start = Date.now()
  let t1 = start
  let t2 = start
  let dbUpdates = 0
  let wsCount = 0
  try {
    const allWorkspaces = await listAllWorkspaces()
    wsCount = allWorkspaces.length
    if (wsCount === 0) return ''
    t1 = Date.now()

    const { deployments, resourceVersion } = await k8s.listWorkspaceDeployments()
    t2 = Date.now()

    // Workspaces on remote environments have no Deployment in cp's cluster —
    // their status is driven by the env projection (observed + heartbeat), not
    // this watch-k8s path. Skip them so resolveDeploymentStatus(undefined) never
    // clobbers a remote workspace to 'stopped'.
    const remoteIds = await getRemoteWorkspaceIds()

    for (const ws of allWorkspaces) {
      if (remoteIds.has(ws.id)) continue
      // A workspace mid-delete (inverted remote delete) is being reaped by the
      // projection once its placement clears — don't let watch-k8s clobber its
      // 'deleting' status to 'stopped' (which would strand it unreaped).
      if (ws.status === 'deleting') continue
      const dep = deployments.get(ws.id)
      const resolved = k8s.resolveDeploymentStatus(dep)
      if (resolved !== ws.status) {
        await applyStatusChange(ws.id, resolved, ws.status)
        dbUpdates++
      }
      // Cache the deployed template version so "update available" is a pure DB
      // comparison (no live k8s read per status request). Backfills legacy rows
      // and catches annotations changed outside cp (e.g. manual patches). Only
      // sync when the Deployment actually carries a version — don't clobber the
      // last-known value when the Deployment is absent/stopped.
      const ver = k8s.deploymentTemplateVersion(dep)
      if (ver !== null && ver !== ws.runtime_version) {
        await updateWorkspace(ws.id, { runtime_version: ver })
        dbUpdates++
      }
    }

    const elapsed = Date.now() - start
    const level = elapsed > 5000 ? 'warn' : 'log'
    console[level](
      `[Reconcile] full list ${elapsed}ms (db=${t1 - start}ms k8s=${t2 - t1}ms updates=${Date.now() - t2}ms/${dbUpdates}writes workspaces=${wsCount})`,
    )

    return resourceVersion
  } catch (e) {
    console.error('[Reconcile] full list error:', e)
    return ''
  }
}

/**
 * Watch callback: handle a single deployment status change event.
 * We query the workspace from DB to get current status for comparison.
 */
async function handleWatchEvent(workspaceId: string, resolved: k8s.ReconciledStatus) {
  try {
    const ws = await getWorkspace(workspaceId)
    if (!ws) return
    if (resolved === ws.status) return
    await applyStatusChange(workspaceId, resolved, ws.status)
  } catch (e) {
    console.error(`[Reconcile] watch event error for workspace=${workspaceId}:`, e)
  }
}

/**
 * Run one list+watch cycle: full reconcile then watch until the cycle expires.
 * Returns when the cycle duration elapses or the watch errors out.
 */
async function listWatchCycle(): Promise<void> {
  const resourceVersion = await fullReconcile()
  if (!resourceVersion) {
    console.warn('[Reconcile] no resourceVersion from list, skipping watch phase')
    return
  }

  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      console.log('[Reconcile] watch cycle expired, rebuilding')
      abort()
      resolve()
    }, WATCH_CYCLE_MS)

    const abort = k8s.watchDeployments(
      resourceVersion,
      (wsId, status) => handleWatchEvent(wsId, status),
      (err) => {
        console.warn('[Reconcile] watch ended:', err ?? 'connection closed')
        clearTimeout(timer)
        resolve()
      },
    )
  })
}

async function reconcileDeletingCredentials() {
  try {
    const userIds = await listUsersWithDeletingCredentials()
    if (userIds.length === 0) return

    for (const userId of userIds) {
      const allReloaded = await reloadUserWorkspaces(userId)
      if (allReloaded) {
        const creds = await listAllUserCredentials(userId)
        const deletingNames = creds.filter((c) => c.status === 'deleting').map((c) => c.name)
        if (deletingNames.length > 0) {
          await hardDeleteUserCredentials(userId, deletingNames)
          console.log(
            `[Reconcile] hard-deleted credentials for user=${userId}: ${deletingNames.join(', ')}`,
          )
        }
      }
    }
  } catch (e) {
    console.error('[Reconcile] credential cleanup error:', e)
  }
}

export function startReconcileLoop() {
  // Credential cleanup remains on its own cron (every 10s)
  new Cron('*/10 * * * * *', reconcileDeletingCredentials)

  // Token-usage sweep: pull per-turn usage from running agents into the ledger.
  // Idempotent via UNIQUE(dedup_key), so running per cp-replica only duplicates
  // harmless work (same as the other reconcile crons). This is a backstop: the
  // common case is covered by the per-turn pull on session.ended; the sweep
  // catches stopped→running backlog and any workspace whose turns never fired
  // a pull. 30min is plenty — no freshness requirement for a usage ledger.
  // protect:true — a sweep that runs long (large backlog) must not overlap the
  // next tick and stack up; the skipped tick's work waits for the next.
  new Cron('*/30 * * * *', { protect: true }, () =>
    sweepRunningWorkspaces().catch((e) =>
      console.error('[Reconcile] usage sweep error:', e instanceof Error ? e.message : e),
    ),
  )

  // Idle-workspace GC: hourly sweep that stops long-idle workspaces to reclaim
  // CPU/memory. Gated behind IDLE_WORKSPACE_GC_DAYS — unset or non-positive
  // keeps it off, so the code can ship dormant while the auto-start fallback
  // soaks, then be switched on by setting the env var (which doubles as the
  // idle threshold and a kill-switch).
  const gcDays = Number(process.env.IDLE_WORKSPACE_GC_DAYS)
  if (Number.isFinite(gcDays) && gcDays > 0) {
    new Cron('0 * * * *', () => runIdleWorkspaceGC(gcDays))
    console.log(`[Reconcile] idle-workspace GC enabled — hourly sweep, threshold ${gcDays}d`)
  }

  // Remote env projection: derive workspaces.status from runner-reported
  // observed state + heartbeat freshness, and keep the forward proxies in step.
  // Cheap no-op while there are no remote environments. protect:true so a slow
  // pass never stacks.
  new Cron(ENV_PROJECTION_INTERVAL, { protect: true }, () =>
    runEnvProjection(ENV_HEARTBEAT_TIMEOUT_SEC).catch((e) =>
      console.error('[Reconcile] env projection error:', e instanceof Error ? e.message : e),
    ),
  )

  // List+watch loop: runs continuously, each cycle is ~10 minutes
  const run = async () => {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      await listWatchCycle()
      // Brief pause before rebuilding to avoid tight loops on repeated errors
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
  run().catch((e) => console.error('[Reconcile] fatal error:', e))

  console.log(`[Reconcile] Started (list+watch, cycle=${WATCH_CYCLE_MS / 1000}s)`)
}
