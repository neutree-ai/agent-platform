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

/** Ready replica ids per workspace, sorted. Absent = no auto-scaling replicas. */
const readyReplicas = new Map<string, number[]>()
/** Round-robin cursor per workspace, so new sessions spread across replicas. */
const rrCursor = new Map<string, number>()

/**
 * Replace the whole ready-replica picture from one observation snapshot (every
 * workspace currently reporting replicas). A full replace, not an upsert, so a
 * workspace that stopped reporting (scaled to zero, deleted) drops out and its
 * routing falls back to the default address. Cursors for vanished workspaces are
 * pruned so the maps can't grow without bound.
 */
export function syncReadyReplicas(snapshot: ReadonlyMap<string, number[]>): void {
  readyReplicas.clear()
  for (const [workspaceId, ids] of snapshot) {
    if (ids.length > 0)
      readyReplicas.set(
        workspaceId,
        [...ids].sort((a, b) => a - b),
      )
  }
  for (const workspaceId of rrCursor.keys()) {
    if (!readyReplicas.has(workspaceId)) rrCursor.delete(workspaceId)
  }
}

/**
 * Poll the runner-reported ready-replica sets out of workspace_placements and
 * refresh the in-memory picture. Run on a cp cron. Cheap no-op while no
 * workspace is auto-scaling (the query returns nothing).
 */
export async function refreshReplicaRouter(): Promise<void> {
  const rows = await listWorkspaceReplicaSets()
  syncReadyReplicas(new Map(rows.map((r) => [r.workspace_id, r.ready_replica_ids])))
}

/**
 * Resolve the replica a turn should hit.
 *
 * - No ready set (static workspace, or auto-scaling scaled to zero / not yet
 *   observed) → undefined: the caller routes to the default address.
 * - A `currentBinding` still in the ready set → keep it (session affinity holds
 *   across turns, and across a stream drop where the replica stayed alive).
 * - Otherwise (a new session, or a bound replica that dropped out of the ready
 *   set — pod died / scaled away) → pick a fresh replica, round-robin so load
 *   spreads. This is the observe-driven rebind: the session resumes on a healthy
 *   replica from the shared-volume transcript.
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
  if (currentBinding !== undefined && ready.includes(currentBinding)) return currentBinding

  const cursor = rrCursor.get(workspaceId) ?? 0
  rrCursor.set(workspaceId, cursor + 1)
  return ready[cursor % ready.length]
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

/** Test seam: forget all in-memory routing state. */
export function __resetReplicaRouter(): void {
  readyReplicas.clear()
  rrCursor.clear()
}
