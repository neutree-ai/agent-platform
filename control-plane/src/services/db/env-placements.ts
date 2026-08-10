// Environment-scoped placement queries for the /env/v1 protocol.
//
// Every function takes the caller's environmentId (from the env-token principal)
// and forces WHERE environment_id = $env into the SQL. A runner can therefore
// only ever read/write placements of its own environment, no matter what
// workspace id it passes. This is the data-layer half of that guarantee; the
// middleware is the auth half.

import { pool } from './pool'

interface ProtocolPlacement {
  workspace_id: string
  environment_id: string
  desired_phase: string
  spec: unknown
  spec_version: number
  observed_phase: string | null
  observed_version: number | null
  endpoint: unknown
  observed_template_version: number | null
}

/**
 * Desired-state snapshot for one environment. Returns the full set the runner is
 * responsible for (it reconciles actual→desired and noops on converged rows).
 * `since` is an optional bandwidth optimization: only rows whose spec changed
 * beyond that version. Lifecycle drift (desired≠observed) is detected by the
 * runner from the rows themselves, so callers that pass `since` should still do
 * periodic full pulls.
 */
export async function listPlacementsForEnvironment(
  environmentId: string,
  since?: number,
): Promise<ProtocolPlacement[]> {
  const cols = `workspace_id, environment_id, desired_phase, spec, spec_version,
                observed_phase, observed_version, endpoint, observed_template_version`
  if (since != null) {
    const { rows } = await pool.query(
      `SELECT ${cols} FROM workspace_placements
        WHERE environment_id = $1 AND spec_version > $2`,
      [environmentId, since],
    )
    return rows
  }
  const { rows } = await pool.query(
    `SELECT ${cols} FROM workspace_placements WHERE environment_id = $1`,
    [environmentId],
  )
  return rows
}

interface ObservedReport {
  phase: string
  endpoint?: unknown
  message?: string | null
  /** Set only after converging to a spec version (post-apply); else untouched. */
  version?: number | null
  /** Pod-template version of the running workload; null leaves the stored one. */
  templateVersion?: number | null
}

/**
 * Write observed state, scoped to the environment. Returns false if no row
 * matched (workspace not in this environment) — the route turns that into 404
 * so a runner can't probe or write placements outside its scope.
 */
export async function writeObservedForEnvironment(
  environmentId: string,
  workspaceId: string,
  o: ObservedReport,
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE workspace_placements
        SET observed_phase = $3,
            endpoint = $4,
            message = $5,
            observed_version = COALESCE($6, observed_version),
            observed_template_version = COALESCE($7, observed_template_version),
            reported_at = now()
      WHERE workspace_id = $1 AND environment_id = $2`,
    [
      workspaceId,
      environmentId,
      o.phase,
      o.endpoint != null ? JSON.stringify(o.endpoint) : null,
      o.message ?? null,
      o.version ?? null,
      o.templateVersion ?? null,
    ],
  )
  return (result.rowCount ?? 0) > 0
}

interface WorkspaceRouting {
  workspace_id: string
  /** The workspace's runtime shape, which decides how its address is formed. */
  runtime_mode: string
  /** Ready replica ids the runner reported; null before its first observation. */
  ready_replica_ids: number[] | null
  /**
   * The workspace's per-replica turn capacity — the same per-workspace knob the
   * scheduler caps concurrent jobs with. Null only for a placement with no
   * config row (shouldn't happen); the turn gate then leaves it unenforced.
   */
  max_concurrency: number | null
}

/**
 * Everything the in-memory replica router needs, in one query: each workspace's
 * runtime shape, the ready-replica set its runner reported, and its per-replica
 * turn capacity. Environment-agnostic — built-in and remote runners write the
 * same columns, so cp gets a uniform picture without knowing where a workspace
 * runs.
 */
export async function listWorkspaceRouting(): Promise<WorkspaceRouting[]> {
  const { rows } = await pool.query(
    `SELECT p.workspace_id,
            p.runtime_mode,
            p.endpoint->'readyReplicaIds' AS ready_replica_ids,
            wc.max_concurrency
       FROM workspace_placements p
       LEFT JOIN workspace_config wc ON wc.workspace_id = p.workspace_id`,
  )
  return rows as WorkspaceRouting[]
}

/**
 * Ready/desired replica counts for an auto-scaling workspace, for the status
 * API (e.g. rendering "running (2/3)"). `desired` is the autoscaler-owned
 * `spec.replicas`; `ready` is how many the runner reports Ready
 * (`endpoint.readyReplicaIds`). Returns null for a static workspace, whose
 * replica count is a constant and means nothing to render. Uniform across
 * built-in and remote (both write the same columns), so no live-k8s read is
 * needed.
 */
export async function getWorkspaceReplicaStatus(
  workspaceId: string,
): Promise<{ ready: number; desired: number } | null> {
  const { rows } = await pool.query(
    `SELECT runtime_mode AS mode,
            COALESCE((spec->>'replicas')::int, 0) AS desired,
            COALESCE(jsonb_array_length(endpoint->'readyReplicaIds'), 0) AS ready
       FROM workspace_placements
      WHERE workspace_id = $1`,
    [workspaceId],
  )
  const row = rows[0]
  if (!row || row.mode !== 'auto-scaling') return null
  return { ready: row.ready, desired: row.desired }
}

/**
 * Whether a workspace is placed on this environment. The tenant-isolation check
 * for calls that name a workspace but do not otherwise read its placement row —
 * a runner may only act on workspaces it was actually given.
 */
export async function workspaceIsOnEnvironment(
  environmentId: string,
  workspaceId: string,
): Promise<boolean> {
  const { rows } = await pool.query(
    'SELECT 1 FROM workspace_placements WHERE workspace_id = $1 AND environment_id = $2',
    [workspaceId, environmentId],
  )
  return rows.length > 0
}

/** Remove a placement after destroy, scoped to the environment. */
export async function deletePlacementForEnvironment(
  environmentId: string,
  workspaceId: string,
): Promise<boolean> {
  const result = await pool.query(
    'DELETE FROM workspace_placements WHERE workspace_id = $1 AND environment_id = $2',
    [workspaceId, environmentId],
  )
  return (result.rowCount ?? 0) > 0
}

/**
 * Record a runner heartbeat: refresh last_heartbeat_at, mark online, and merge
 * runner-reported capabilities. Built-in is never updated through here (it has no
 * token), so the local cluster's status stays under cp's own control.
 */
export async function recordHeartbeat(
  environmentId: string,
  capabilities?: Record<string, unknown>,
): Promise<void> {
  await pool.query(
    `UPDATE environments
        SET last_heartbeat_at = now(),
            status = 'online',
            capabilities = COALESCE($2, capabilities)
      WHERE id = $1`,
    [environmentId, capabilities != null ? JSON.stringify(capabilities) : null],
  )
}
