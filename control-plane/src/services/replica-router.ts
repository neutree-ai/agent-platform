// Replica routing for auto-scaling workspaces.
//
// An auto-scaling workspace runs 0..N replicas that all mount the same RWX
// workspace volume. A session's turns must keep hitting the SAME replica (the
// turn is a long-lived SSE to one agent process, and its transcript file can't
// be appended by two replicas at once). This module owns that affinity: it
// tracks which replicas are reachable and picks / keeps a session's replica.
//
// It is driven ENTIRELY by the reported ready-replica set, never by a
// workspace's configured runtime_mode: a static workspace never reports a ready
// set, so its entry stays absent and every routing call resolves to "no replica"
// → the workspace's default address, byte-identical to a pre-auto-scaling cp.
// This keeps the router dormant until an auto-scaling workspace actually reports
// replicas, with no dependency on the config columns that gate creation.
//
// Source of the ready set: cp does NOT observe replicas in-process — the runner
// (a separate env-runner deployment, built-in and remote alike) writes its
// observation, including endpoint.readyReplicaIds, to workspace_placements. cp
// polls that column periodically ({@link refreshReplicaRouter}) and rebuilds
// this in-memory set. So the set is cp-memory only: it survives cp restart by
// being rebuilt from the next poll, and a session's chosen replica — the one
// thing that must persist — lives on sessions.replica_ordinal.
//
// The provider-assigned replica id is an opaque int here (k8s: a StatefulSet
// ordinal); the router assumes nothing about it being contiguous or ordered.

import { listWorkspaceReplicaSets } from './db/env-placements'

/** Per-workspace snapshot of one observation: ready replicas + capacity input. */
interface ReplicaSnapshot {
  /** Provider-assigned ids of the ready replicas. */
  ids: number[]
  /**
   * The workspace's per-replica turn capacity (its own max_concurrency). Feeds
   * the turn gate's capacity sizing; undefined when unknown (no config row),
   * which leaves the workspace unenforced.
   */
  perReplicaCapacity?: number
}

/** Ready replica ids per workspace, sorted. Absent = no auto-scaling replicas. */
const readyReplicas = new Map<string, number[]>()
/** Per-replica turn capacity (max_concurrency) per workspace. */
const perReplicaCap = new Map<string, number>()
/** Round-robin cursor per workspace, so new sessions spread across replicas. */
const rrCursor = new Map<string, number>()
/**
 * Draining replica ids per workspace: the ones the autoscaler is about to remove
 * (scale-down). They still serve the turns already bound to them, but take no NEW
 * session — pickReplicaForTurn steers new picks (and rebinds) away — so they go
 * turn-free and can be dropped. Kept intersected with the ready set on every sync,
 * so a replica that has actually left ready also leaves draining.
 */
const drainingReplicas = new Map<string, Set<number>>()

/**
 * Replace the whole ready-replica picture from one observation snapshot (every
 * workspace currently reporting replicas). A full replace, not an upsert, so a
 * workspace that stopped reporting (scaled to zero, deleted) drops out and its
 * routing falls back to the default address. Cursors for vanished workspaces are
 * pruned so the maps can't grow without bound.
 */
export function syncReadyReplicas(snapshot: ReadonlyMap<string, ReplicaSnapshot>): void {
  readyReplicas.clear()
  perReplicaCap.clear()
  for (const [workspaceId, snap] of snapshot) {
    if (snap.ids.length === 0) continue
    readyReplicas.set(
      workspaceId,
      [...snap.ids].sort((a, b) => a - b),
    )
    if (snap.perReplicaCapacity !== undefined)
      perReplicaCap.set(workspaceId, snap.perReplicaCapacity)
  }
  for (const workspaceId of rrCursor.keys()) {
    if (!readyReplicas.has(workspaceId)) rrCursor.delete(workspaceId)
  }
  // Keep draining marks pinned to replicas that still exist: a drained replica
  // that has left the ready set is gone, so its mark is meaningless; and a
  // workspace that stopped reporting drops its whole draining set.
  for (const [workspaceId, ids] of drainingReplicas) {
    const ready = readyReplicas.get(workspaceId)
    if (!ready) {
      drainingReplicas.delete(workspaceId)
      continue
    }
    for (const id of ids) if (!ready.includes(id)) ids.delete(id)
    if (ids.size === 0) drainingReplicas.delete(workspaceId)
  }
}

/**
 * Poll the runner-reported ready-replica sets out of workspace_placements and
 * refresh the in-memory picture. Run on a cp cron. Cheap no-op while no
 * workspace is auto-scaling (the query returns nothing).
 */
export async function refreshReplicaRouter(): Promise<void> {
  const rows = await listWorkspaceReplicaSets()
  syncReadyReplicas(
    new Map(
      rows.map((r) => [
        r.workspace_id,
        { ids: r.ready_replica_ids, perReplicaCapacity: r.max_concurrency ?? undefined },
      ]),
    ),
  )
}

/**
 * Resolve the replica a turn should hit.
 *
 * - No ready set (static workspace, or auto-scaling scaled to zero / not yet
 *   observed) → undefined: the caller routes to the default address.
 * - A `currentBinding` still in the ready set and NOT draining → keep it (session
 *   affinity holds across turns, and across a stream drop where the replica
 *   stayed alive).
 * - Otherwise (a new session; a bound replica that dropped out of the ready set —
 *   pod died / scaled away; or a bound replica now draining) → pick a fresh
 *   replica, round-robin over the non-draining ready set so load spreads and the
 *   draining replica sheds its sessions. This is the observe-driven rebind: the
 *   session resumes on a healthy replica from the shared-volume transcript.
 *
 * The load-aware refinement (pick the least-busy replica using live turn counts)
 * arrives with the turn gate; round-robin is the dormant-stage placeholder.
 */
export function pickReplicaForTurn(
  workspaceId: string,
  currentBinding?: number,
): number | undefined {
  const ready = readyReplicas.get(workspaceId)
  if (!ready || ready.length === 0) return undefined
  const draining = drainingReplicas.get(workspaceId)
  if (
    currentBinding !== undefined &&
    ready.includes(currentBinding) &&
    !draining?.has(currentBinding)
  )
    return currentBinding

  // Prefer non-draining replicas; fall back to the full set only in the corner
  // case where every ready replica is draining (a workspace on its way to zero),
  // so a turn that must run still lands somewhere.
  const pickable = draining ? ready.filter((id) => !draining.has(id)) : ready
  const pool = pickable.length > 0 ? pickable : ready
  const cursor = rrCursor.get(workspaceId) ?? 0
  rrCursor.set(workspaceId, cursor + 1)
  return pool[cursor % pool.length]
}

/**
 * Mark exactly `ids` as the draining set of a workspace (a full replace, so `[]`
 * clears it). The autoscaler calls this when it decides which replicas a pending
 * scale-down will remove: they keep serving bound turns but take no new session,
 * so they drain to turn-free and can be dropped. Only ids currently in the ready
 * set are retained — a stale drain target is silently ignored.
 */
export function setDraining(workspaceId: string, ids: number[]): void {
  if (ids.length === 0) {
    drainingReplicas.delete(workspaceId)
    return
  }
  const ready = readyReplicas.get(workspaceId)
  const set = new Set(ready ? ids.filter((id) => ready.includes(id)) : [])
  if (set.size === 0) drainingReplicas.delete(workspaceId)
  else drainingReplicas.set(workspaceId, set)
}

/**
 * The ready replica ids of a workspace, sorted ascending (empty for a static or
 * scaled-to-zero workspace). The autoscaler reads this to compute which ordinals
 * a scale-down would remove.
 */
export function readyReplicaIds(workspaceId: string): readonly number[] {
  return readyReplicas.get(workspaceId) ?? []
}

/**
 * How many replicas a workspace currently has ready. 0 for a static workspace
 * (never reports a ready set) or an auto-scaling one scaled to zero / not yet
 * observed. The turn gate uses this both to tell the two shapes apart (0 =
 * static = account-only) and to size auto-scaling capacity.
 */
export function readyReplicaCount(workspaceId: string): number {
  return readyReplicas.get(workspaceId)?.length ?? 0
}

/**
 * A workspace's per-replica turn capacity (its own max_concurrency), or
 * undefined for a static workspace or one whose capacity is unknown. The turn
 * gate multiplies this by the ready replica count to size admission.
 */
export function perReplicaCapacity(workspaceId: string): number | undefined {
  return perReplicaCap.get(workspaceId)
}

/** Test seam: forget all in-memory routing state. */
export function __resetReplicaRouter(): void {
  readyReplicas.clear()
  perReplicaCap.clear()
  rrCursor.clear()
  drainingReplicas.clear()
}
