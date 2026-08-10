import { Cron } from 'croner'
import { reloadUserWorkspaces } from '../routes/credentials'
import { drainAll } from '../services/chat/turn-gate'
import {
  hardDeleteUserCredentials,
  listAllUserCredentials,
  listUsersWithDeletingCredentials,
} from '../services/db/credentials'
import { closeDeletedWorkspaceIntervals } from '../services/db/runtime-meter'
import { sweepSupersededWorkspaceTokens } from '../services/db/workspace-tokens'
import { runEnvProjection } from '../services/env-projection'
import { runIdleWorkspaceGC } from '../services/idle-workspace-gc'
import { refreshReplicaRouter } from '../services/replica-router'
import { runRuntimeMeter } from '../services/runtime-meter'
import { sweepRunningWorkspaces } from '../services/usage/pull'
import { runAutoscaler } from '../services/workspace-autoscaler'

// How often to project placements → workspaces.status, and how long without a
// runner heartbeat before a remote environment is considered offline.
const ENV_PROJECTION_INTERVAL = '*/15 * * * * *'
const ENV_HEARTBEAT_TIMEOUT_SEC = Number(process.env.ENV_HEARTBEAT_TIMEOUT_SEC) || 60

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

  // Superseded workspace tokens: each placement mints a fresh one, so a rebuilt
  // workspace leaves its predecessor behind. Retire the ones past the overlap
  // grace. Hourly is ample — these are already inert (nothing holds them) and the
  // grace is an hour anyway. protect:true so a slow pass never stacks.
  new Cron('17 * * * *', { protect: true }, () =>
    sweepSupersededWorkspaceTokens()
      .then((n) => {
        if (n > 0) console.log(`[Reconcile] revoked ${n} superseded workspace token(s)`)
      })
      .catch((e) =>
        console.error('[Reconcile] token sweep error:', e instanceof Error ? e.message : e),
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

  // Status projection: derive every workspace's status from what its runner
  // reported into workspace_placements, and keep the remote forward proxies in
  // step. This is the only path that writes workspaces.status. protect:true so a
  // slow pass never stacks.
  new Cron(ENV_PROJECTION_INTERVAL, { protect: true }, () =>
    runEnvProjection(ENV_HEARTBEAT_TIMEOUT_SEC).catch((e) =>
      console.error('[Reconcile] status projection error:', e instanceof Error ? e.message : e),
    ),
  )

  // Replica-router refresh: rebuild cp's in-memory routing picture — each
  // workspace's runtime shape and its runner-reported ready replicas — from
  // workspace_placements. Draining afterwards releases turns that were waiting
  // on capacity the refresh just revealed (a replica became ready), which no
  // slot release would have triggered. protect:true so a slow pass never stacks.
  new Cron(ENV_PROJECTION_INTERVAL, { protect: true }, () =>
    refreshReplicaRouter()
      .then(drainAll)
      .catch((e) =>
        console.error(
          '[Reconcile] replica router refresh error:',
          e instanceof Error ? e.message : e,
        ),
      ),
  )

  // Runtime meter: append a row wherever a workspace's observed runtime state
  // moved. Its own pass rather than a step inside the projection above, so that
  // a failure of the billing log cannot stop cp from projecting status — and so
  // that its coverage mark, which is what makes an outage visible to rating,
  // depends only on the meter's own success. protect:true so a slow pass never
  // stacks.
  new Cron(ENV_PROJECTION_INTERVAL, { protect: true }, () =>
    runRuntimeMeter(ENV_HEARTBEAT_TIMEOUT_SEC).catch((e) =>
      console.error('[Reconcile] runtime meter error:', e instanceof Error ? e.message : e),
    ),
  )

  // Deleted-workspace close-out for the meter: a workspace leaves the pass the
  // moment its placement goes, so its last logged row would stay open forever.
  // Reads the log rather than the placements, and an interval that ends a few
  // minutes late on an already-deleted workspace changes nothing.
  new Cron('*/5 * * * *', { protect: true }, () =>
    closeDeletedWorkspaceIntervals()
      .then((ids) => {
        if (ids.length > 0) {
          console.log(`[RuntimeMeter] closed ${ids.length} deleted workspace interval(s)`)
        }
      })
      .catch((e) =>
        console.error(
          '[Reconcile] runtime meter close-out error:',
          e instanceof Error ? e.message : e,
        ),
      ),
  )

  // Autoscaler: size each auto-scaling workspace's replicas to live turn demand.
  // Same 15s cadence; a no-op while no workspace is auto-scaling. protect:true so
  // a slow pass never stacks. Runs after the router refresh above so demand is
  // read against a fresh ready-replica picture.
  new Cron(ENV_PROJECTION_INTERVAL, { protect: true }, () =>
    runAutoscaler().catch((e) =>
      console.error('[Reconcile] autoscaler error:', e instanceof Error ? e.message : e),
    ),
  )

  console.log('[Reconcile] Started')
}
