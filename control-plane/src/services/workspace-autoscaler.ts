import { turnDemand } from './chat/turn-gate'
import { pool } from './db/pool'
import { setDesiredReplicas } from './placement'

// The workspace autoscaler: a periodic control loop that sizes each auto-scaling
// workspace's replica count to its live turn demand. It reads the demand signal
// straight from the turn gate (active + queued turns) — no separate metric — and
// writes the desired count through the placement queue, which the env-runner
// converges. Static workspaces are never touched (they have no auto_scaling
// config, so the query below skips them).
//
// This stage does SCALE-UP only: replicas grow to meet demand or the min floor,
// and never shrink here. Scale-down is delicate (drain live turns off a replica
// before removing it) and lands in its own stage; until then an auto-scaling
// workspace that has grown stays grown, which is safe (over-provisioned), just
// not yet economical.

/**
 * The replica count a workspace should run for its demand: enough replicas to
 * carry (active + queued) turns at perReplicaCapacity each, clamped to the
 * workspace's [min, max]. Pure — the loop's testable core.
 */
export function desiredReplicas(
  demand: { active: number; queued: number },
  opts: { perReplicaCapacity: number; min: number; max: number },
): number {
  const need = Math.ceil((demand.active + demand.queued) / Math.max(opts.perReplicaCapacity, 1))
  return Math.min(Math.max(need, opts.min), opts.max)
}

interface AutoScalingRow {
  workspace_id: string
  min_replicas: number
  max_replicas: number
  max_concurrency: number
  current_replicas: number
}

/** Running auto-scaling workspaces with the numbers the loop needs. */
async function listAutoScalingWorkspaces(): Promise<AutoScalingRow[]> {
  const { rows } = await pool.query(
    `SELECT wc.workspace_id,
            (wc.auto_scaling->>'min_replicas')::int AS min_replicas,
            (wc.auto_scaling->>'max_replicas')::int AS max_replicas,
            wc.max_concurrency,
            COALESCE((wp.spec->>'replicas')::int, 1) AS current_replicas
       FROM workspace_config wc
       JOIN workspace_placements wp ON wp.workspace_id = wc.workspace_id
      WHERE wc.auto_scaling IS NOT NULL
        AND wp.desired_phase = 'running'`,
  )
  return rows
}

/**
 * One autoscaler pass. Cheap no-op while no workspace is auto-scaling (the query
 * returns nothing). Scale-UP only: writes a higher desired count when demand (or
 * the min floor) calls for it; never reduces.
 */
export async function runAutoscaler(): Promise<void> {
  for (const ws of await listAutoScalingWorkspaces()) {
    const target = desiredReplicas(turnDemand(ws.workspace_id), {
      perReplicaCapacity: ws.max_concurrency,
      min: ws.min_replicas,
      max: ws.max_replicas,
    })
    if (target > ws.current_replicas) {
      await setDesiredReplicas(ws.workspace_id, target)
      console.log(`[Autoscaler] scale up ws=${ws.workspace_id} ${ws.current_replicas} → ${target}`)
    }
  }
}
