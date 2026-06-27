import type {
  ObservedUpdate,
  PlacementRow,
  PlacementTransport,
} from '../../internal/env-runner-core'
import { pool } from './db'

// Direct-DB transport for the built-in / same-cluster runner: it reads and
// writes workspace_placements over the pg pool. Scoped by kind='kubernetes' so
// this k8s runner picks up the built-in environment and any additional k8s
// environments automatically (the per-environment scoping that the env-token
// enforces for remote runners is, here, the cluster boundary itself).
export class DbTransport implements PlacementTransport {
  async listPlacements(): Promise<PlacementRow[]> {
    const { rows } = await pool.query(
      `SELECT p.workspace_id, p.environment_id, p.desired_phase, p.spec,
              p.spec_version, p.observed_phase, p.observed_version
         FROM workspace_placements p
         JOIN environments e ON e.id = p.environment_id
        WHERE e.kind = 'kubernetes'`,
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
