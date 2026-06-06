import { Cron } from 'croner'
import { reloadUserWorkspaces } from '../routes/credentials'
import {
  hardDeleteUserCredentials,
  listAllUserCredentials,
  listUsersWithDeletingCredentials,
} from '../services/db/credentials'
import { resetAllSessionsIdle } from '../services/db/sessions'
import { getWorkspace, listAllWorkspaces, updateWorkspace } from '../services/db/workspaces'
import { runIdleWorkspaceGC } from '../services/idle-workspace-gc'
import * as k8s from '../services/k8s'
import { sweepRunningWorkspaces } from '../services/usage/pull'

const WATCH_CYCLE_MS = 10 * 60 * 1000 // 10 minutes

/**
 * Handle a workspace status change: update DB and reset chat_status if needed.
 * Used by both the full list reconcile and the watch callback.
 */
async function applyStatusChange(
  workspaceId: string,
  resolved: k8s.ReconciledStatus,
  dbStatus?: string,
) {
  // If we have prior DB state, skip no-ops
  if (dbStatus !== undefined && resolved === dbStatus) return

  await updateWorkspace(workspaceId, { status: resolved })
  console.log(`[Reconcile] workspace=${workspaceId} ${dbStatus ?? '?'} → ${resolved}`)

  // Reset stale chat_status for stopped/error workspaces. The session-level
  // update is no-op when nothing is non-idle, so we don't need to gate it.
  if (resolved === 'stopped' || resolved === 'error') {
    await resetAllSessionsIdle(workspaceId)
  }
  // AFS remount is handled by the afs-fuse sidecar's boot-pull
  // (AFS_BOOTSTRAP_URL), which is the correct event source: it fires on
  // every pod start regardless of whether cp observed the transition.
}

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

    for (const ws of allWorkspaces) {
      const resolved = k8s.resolveDeploymentStatus(deployments.get(ws.id))
      if (resolved !== ws.status) {
        await applyStatusChange(ws.id, resolved, ws.status)
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
