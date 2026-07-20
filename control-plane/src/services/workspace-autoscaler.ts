import { turnDemand } from './chat/turn-gate'
import { pool } from './db/pool'
import { replicasHaveActiveTurn } from './db/sessions'
import { setDesiredPhase, setDesiredReplicas } from './placement'
import { readyReplicaIds, setDraining } from './replica-router'

// The workspace autoscaler: a periodic control loop that sizes each auto-scaling
// workspace's replica count to its live turn demand. It reads the demand signal
// straight from the turn gate (active + queued turns) — no separate metric — and
// writes the desired count through the placement queue, which the env-runner
// converges. Static workspaces are never touched (they have no auto_scaling
// config, so the query below skips them).
//
// Scale-up is immediate (over-provisioning is safe). Scale-down is deliberate:
// it waits SCALE_DOWN_ROUNDS consecutive low rounds, then removes one replica at
// a time — and only a replica the router has drained to turn-free, so no live
// turn is killed. Scale-to-zero stops an idle workspace outright (reversible: the
// next turn auto-starts it), independent of the replica floor.

/** Consecutive low rounds required before a scale-down step (~3 × 15s ≈ 45s). */
const SCALE_DOWN_ROUNDS = Number(process.env.AUTOSCALER_SCALE_DOWN_ROUNDS) || 3

/** Consecutive-low-round counter per workspace, for scale-down hysteresis. */
const lowRounds = new Map<string, number>()
/** When a workspace first went fully idle (ms), for scale-to-zero timing. */
const idleSince = new Map<string, number>()

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

/**
 * Which ready ordinals a scale-down to `desired` removes. Encodes the k8s
 * StatefulSet convention directly — scaling to N keeps ordinals 0..N-1 and drops
 * the rest — because cp can't call a remote provider's nextRemovedReplicaIds
 * across the tunnel (design §7). A non-k8s provider with a different removal
 * order would need this convention taught per-provider; today every provider is
 * k8s, so the assumption holds. Pure.
 */
export function replicasToRemove(readyIds: readonly number[], desired: number): number[] {
  return readyIds.filter((id) => id >= desired).sort((a, b) => a - b)
}

interface AutoScalingRow {
  workspace_id: string
  min_replicas: number
  max_replicas: number
  scale_to_zero_idle_seconds: number | null
  max_concurrency: number
  current_replicas: number
}

/** Running auto-scaling workspaces with the numbers the loop needs. */
async function listAutoScalingWorkspaces(): Promise<AutoScalingRow[]> {
  const { rows } = await pool.query(
    `SELECT wc.workspace_id,
            (wc.auto_scaling->>'min_replicas')::int AS min_replicas,
            (wc.auto_scaling->>'max_replicas')::int AS max_replicas,
            (wc.auto_scaling->>'scale_to_zero_idle_seconds')::int AS scale_to_zero_idle_seconds,
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
 * Stop a fully-idle workspace once it has been idle past its configured
 * threshold. Returns true if it acted (so the caller skips replica scaling this
 * round). Idle = no active and no queued turns; the idle clock is kept in memory
 * and reset the moment any demand appears. A stopped workspace drops out of the
 * running query and auto-starts on its next turn (data is on the shared volume,
 * so this is lossless). No-op when scale_to_zero_idle_seconds is unset.
 */
async function maybeScaleToZero(ws: AutoScalingRow): Promise<boolean> {
  const demand = turnDemand(ws.workspace_id)
  const idle = demand.active === 0 && demand.queued === 0
  if (!idle) {
    idleSince.delete(ws.workspace_id)
    return false
  }
  if (ws.scale_to_zero_idle_seconds == null) return false
  const since = idleSince.get(ws.workspace_id)
  if (since === undefined) {
    idleSince.set(ws.workspace_id, Date.now())
    return false
  }
  if (Date.now() - since < ws.scale_to_zero_idle_seconds * 1000) return false
  await setDesiredPhase(ws.workspace_id, 'stopped')
  idleSince.delete(ws.workspace_id)
  lowRounds.delete(ws.workspace_id)
  setDraining(ws.workspace_id, [])
  console.log(
    `[Autoscaler] scale to zero ws=${ws.workspace_id} (idle > ${ws.scale_to_zero_idle_seconds}s)`,
  )
  return true
}

/**
 * Take one replica off a workspace, safely. Marks the ordinals the provider will
 * remove as draining (so the router steers new sessions away), then reduces the
 * desired count only once those ordinals carry no in-flight turn. If one still
 * does, it holds — the ordinals stay draining and it retries next round.
 */
async function tryScaleDownOne(ws: AutoScalingRow): Promise<void> {
  const newDesired = ws.current_replicas - 1
  const removing = replicasToRemove(readyReplicaIds(ws.workspace_id), newDesired)
  setDraining(ws.workspace_id, removing)
  // Observed set already at/below the new target (still converging up, or nothing
  // ready ≥ newDesired) — nothing to drain, just write the lower desired.
  if (removing.length === 0) {
    await setDesiredReplicas(ws.workspace_id, newDesired)
    lowRounds.delete(ws.workspace_id)
    return
  }
  if (await replicasHaveActiveTurn(ws.workspace_id, removing)) return
  await setDesiredReplicas(ws.workspace_id, newDesired)
  lowRounds.delete(ws.workspace_id)
  console.log(
    `[Autoscaler] scale down ws=${ws.workspace_id} ${ws.current_replicas} → ${newDesired}`,
  )
}

/**
 * One autoscaler pass. Cheap no-op while no workspace is auto-scaling (the query
 * returns nothing). Per workspace: scale to zero if idle; else scale up on demand
 * immediately, or scale down by one after SCALE_DOWN_ROUNDS consecutive low
 * rounds.
 */
export async function runAutoscaler(): Promise<void> {
  const seen = new Set<string>()
  for (const ws of await listAutoScalingWorkspaces()) {
    seen.add(ws.workspace_id)
    if (await maybeScaleToZero(ws)) continue

    const target = desiredReplicas(turnDemand(ws.workspace_id), {
      perReplicaCapacity: ws.max_concurrency,
      min: ws.min_replicas,
      max: ws.max_replicas,
    })

    if (target > ws.current_replicas) {
      await setDesiredReplicas(ws.workspace_id, target)
      setDraining(ws.workspace_id, [])
      lowRounds.delete(ws.workspace_id)
      console.log(`[Autoscaler] scale up ws=${ws.workspace_id} ${ws.current_replicas} → ${target}`)
    } else if (target < ws.current_replicas) {
      const rounds = (lowRounds.get(ws.workspace_id) ?? 0) + 1
      lowRounds.set(ws.workspace_id, rounds)
      if (rounds >= SCALE_DOWN_ROUNDS) await tryScaleDownOne(ws)
    } else {
      // Demand matches the current count — cancel any pending scale-down.
      lowRounds.delete(ws.workspace_id)
      setDraining(ws.workspace_id, [])
    }
  }
  // Drop in-memory hysteresis for workspaces no longer running/auto-scaling, so
  // the maps can't grow without bound.
  for (const k of lowRounds.keys()) if (!seen.has(k)) lowRounds.delete(k)
  for (const k of idleSince.keys()) if (!seen.has(k)) idleSince.delete(k)
}

/** Test seam: forget all in-memory scaling hysteresis. */
export function __resetAutoscaler(): void {
  lowRounds.clear()
  idleSince.clear()
}
