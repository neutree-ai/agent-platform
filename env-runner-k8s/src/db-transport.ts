import type {
  ObservedUpdate,
  PlacementRow,
  PlacementTransport,
} from '../../internal/env-runner-core'
import { pool } from './db'

// Direct-DB transport for the built-in runner: it reads and writes
// workspace_placements over the pg pool. Scoped to the BUILT-IN environment
// only (is_builtin = true). A remote BYOI environment is also kind='kubernetes'
// but lives in the customer's cluster and is served exclusively by its own
// HttpTransport runner (scoped by env-token); the direct runner must never pick
// up a remote placement, or it would provision a remote workspace in cp's own
// cluster and double-reconcile against the remote runner.
export class DbTransport implements PlacementTransport {
  async listPlacements(): Promise<PlacementRow[]> {
    const { rows } = await pool.query(
      `SELECT p.workspace_id, p.environment_id, p.desired_phase, p.spec,
              p.spec_version, p.observed_phase, p.observed_version
         FROM workspace_placements p
         JOIN environments e ON e.id = p.environment_id
        WHERE e.is_builtin = true`,
    )
    return rows
  }

  async writeObserved(workspaceId: string, o: ObservedUpdate): Promise<void> {
    await pool.query(
      `UPDATE workspace_placements
          SET observed_phase = $2,
              endpoint = $3,
              message = $4,
              observed_version = COALESCE($5, observed_version),
              reported_at = now()
        WHERE workspace_id = $1`,
      [
        workspaceId,
        o.phase,
        o.endpoint != null ? JSON.stringify(o.endpoint) : null,
        o.message ?? null,
        o.version ?? null,
      ],
    )
  }

  async deletePlacement(workspaceId: string): Promise<void> {
    await pool.query('DELETE FROM workspace_placements WHERE workspace_id = $1', [workspaceId])
  }

  // Built-in liveness is cp's own concern (it watches its own cluster), so the
  // direct runner has nothing to report. No-op keeps the core loop uniform.
  async heartbeat(): Promise<void> {}
}
