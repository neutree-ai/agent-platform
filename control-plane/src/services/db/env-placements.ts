// BYOI P2 — environment-scoped placement queries for the /env/v1 protocol.
//
// Every function takes the caller's environmentId (from the env-token principal)
// and forces WHERE environment_id = $env into the SQL. A runner can therefore
// only ever read/write placements of its own environment, no matter what
// workspace id it passes (design §9). This is the data-layer half of that
// guarantee; the middleware is the auth half.

import { pool } from './pool'

interface ProtocolPlacement {
  workspace_id: string
  environment_id: string
  desired_phase: string
  spec: unknown
  spec_version: number
  observed_phase: string | null
  observed_version: number | null
}

/**
 * Desired-state snapshot for one environment. Returns the full set the runner is
 * responsible for (it reconciles actual→desired and noops on converged rows).
 * `since` is an optional bandwidth optimization: only rows whose spec changed
 * beyond that version. Lifecycle drift (desired≠observed) is detected by the
 * runner from the rows themselves, so callers that pass `since` should still do
 * periodic full pulls — mirrors the direct-DB runner's full-list behavior.
 */
export async function listPlacementsForEnvironment(
  environmentId: string,
  since?: number,
): Promise<ProtocolPlacement[]> {
  const cols = `workspace_id, environment_id, desired_phase, spec, spec_version,
                observed_phase, observed_version`
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
            reported_at = now()
      WHERE workspace_id = $1 AND environment_id = $2`,
    [
      workspaceId,
      environmentId,
      o.phase,
      o.endpoint != null ? JSON.stringify(o.endpoint) : null,
      o.message ?? null,
      o.version ?? null,
    ],
  )
  return (result.rowCount ?? 0) > 0
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
