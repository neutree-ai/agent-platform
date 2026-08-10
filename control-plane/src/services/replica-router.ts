// Replica routing.
//
// Every workspace runs some number of replicas — one for the static shape, 0..N
// for auto-scaling — and reports which of them are ready. A session's turns must
// keep hitting the SAME replica (the turn is a long-lived SSE to one agent
// process, and its transcript file can't be appended by two replicas at once).
// This module owns that affinity: it tracks which replicas are reachable and
// picks / keeps a session's replica. Routing is therefore one mechanism sized by
// the reported set, not two code paths.
//
// Source of the ready set: cp does NOT observe replicas in-process — the runner
// (a separate env-runner deployment, built-in and remote alike) writes its
// observation, including endpoint.readyReplicaIds, to workspace_placements. cp
// polls that column periodically ({@link refreshReplicaRouter}) and rebuilds
// this in-memory picture. So it is cp-memory only: it survives cp restart by
// being rebuilt from the next poll, and a session's chosen replica — the one
// thing that must persist — lives on sessions.replica_ordinal.
//
// The runtime mode is tracked alongside because it decides the SHAPE of a
// workspace's address, which is a question the ready set cannot answer: a
// workspace scaled to zero reports nothing yet still has to be addressed as what
// it is.
//
// The provider-assigned replica id is an opaque int here (k8s: a StatefulSet
// ordinal); the router assumes nothing about it being contiguous or ordered.

import type { RuntimeMode } from '../../../internal/types/runtime-mode'
import { listWorkspaceRouting } from './db/env-placements'

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

/** Ready replica ids per workspace, sorted. Absent = nothing ready right now. */
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
 * Each workspace's runtime shape, kept independently of the ready set so it
 * survives a scale to zero — when {@link readyReplicas} is empty but the
 * workspace still has to be addressed as what it is. Populated every refresh
 * from the placement's runtime_mode, so it covers stopped and starting
 * workspaces too. A workspace absent from this map is one cp has not polled yet.
 */
const runtimeModes = new Map<string, RuntimeMode>()

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
 * Poll the routing picture out of workspace_placements and rebuild the in-memory
 * state. Run on a cp cron.
 */
export async function refreshReplicaRouter(): Promise<void> {
  syncRouting(await listWorkspaceRouting())
}

/**
 * Replace the whole routing picture from one row set — a full replace, so a
 * workspace that is gone drops out of every map at once.
 *
 * A row whose mode is not a value this build knows is left out rather than
 * guessed at: the column is constrained to the known set, so an unknown value
 * can only mean a mode the running cp predates, and addressing a workspace as
 * the wrong shape would route its turns into nowhere.
 */
export function syncRouting(
  rows: Iterable<{
    workspace_id: string
    runtime_mode: string
    ready_replica_ids?: number[] | null
    max_concurrency?: number | null
  }>,
): void {
  const snapshot = new Map<string, ReplicaSnapshot>()
  runtimeModes.clear()
  for (const r of rows) {
    snapshot.set(r.workspace_id, {
      ids: r.ready_replica_ids ?? [],
      perReplicaCapacity: r.max_concurrency ?? undefined,
    })
    if (r.runtime_mode === 'static' || r.runtime_mode === 'auto-scaling') {
      runtimeModes.set(r.workspace_id, r.runtime_mode)
    }
  }
  syncReadyReplicas(snapshot)
}

/**
 * A workspace's runtime shape, or undefined when cp has not polled it yet (a
 * workspace created since the last refresh). Callers decide what an unknown
 * shape means for them rather than being handed a guess.
 */
export function runtimeModeOf(workspaceId: string): RuntimeMode | undefined {
  return runtimeModes.get(workspaceId)
}

/**
 * Resolve the replica a turn should hit.
 *
 * - No ready set (nothing running yet, scaled to zero, not yet observed) →
 *   undefined: the caller routes to the workspace's default address.
 * - A `currentBinding` still in the ready set and NOT draining → keep it (session
 *   affinity holds across turns, and across a stream drop where the replica
 *   stayed alive).
 * - Otherwise (a new session; a bound replica that dropped out of the ready set —
 *   pod died / scaled away; or a bound replica now draining) → pick a fresh
 *   replica, round-robin over the non-draining ready set so load spreads and the
 *   draining replica sheds its sessions. This is the observe-driven rebind: the
 *   session resumes on a healthy replica from the shared-volume transcript.
 *
 * Round-robin, not load-aware: the turn gate already caps how much work a
 * replica can be given, so spreading evenly is enough to keep them level.
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
 * The ready replica ids of a workspace, sorted ascending; empty when nothing is
 * running. The autoscaler reads this to compute which ordinals a scale-down
 * would remove; the address seam fans a reload out across it.
 */
export function readyReplicaIds(workspaceId: string): readonly number[] {
  return readyReplicas.get(workspaceId) ?? []
}

/**
 * Any one ready replica of a workspace to serve a workspace-scoped (no session
 * affinity) call — health, config/skills reload, usage pull, file export. All
 * replicas share the workspace volume, so any answers; a non-draining one is
 * preferred so the pick doesn't land on a replica about to be removed. undefined
 * when nothing is ready, and the caller falls back to the workspace's default
 * address. This is what lets an auto-scaling workspace — which has no ClusterIP
 * Service, only per-ordinal headless DNS — be reached without a replica binding.
 */
export function anyReadyReplica(workspaceId: string): number | undefined {
  const ready = readyReplicas.get(workspaceId)
  if (!ready || ready.length === 0) return undefined
  const draining = drainingReplicas.get(workspaceId)
  if (!draining) return ready[0]
  return ready.find((id) => !draining.has(id)) ?? ready[0]
}

/**
 * How many replicas a workspace currently has ready — 1 for a running static
 * workspace, 0..N for an auto-scaling one, 0 when nothing is up or cp has not
 * observed it yet. The turn gate multiplies it by the per-replica capacity.
 */
export function readyReplicaCount(workspaceId: string): number {
  return readyReplicas.get(workspaceId)?.length ?? 0
}

/**
 * A workspace's per-replica turn capacity (its own max_concurrency), or
 * undefined when it is unknown. The turn gate multiplies this by the ready
 * replica count to size admission.
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
  runtimeModes.clear()
}
