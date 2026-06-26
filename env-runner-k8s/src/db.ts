import pg from 'pg'

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://tos:tos@localhost:5432/tos',
  max: Number(process.env.PG_POOL_MAX) || 20,
})

interface PlacementRow {
  workspace_id: string
  environment_id: string
  desired_phase: string
  spec: unknown
  spec_version: number
  observed_phase: string | null
  observed_version: number | null
}

/**
 * Placements this k8s runner is responsible for — those on kind='kubernetes'
 * environments. For v1 that is just the built-in environment; the filter is by
 * kind so additional k8s environments are picked up automatically.
 */
export async function listKubernetesPlacements(): Promise<PlacementRow[]> {
  const { rows } = await pool.query(
    `SELECT p.workspace_id, p.environment_id, p.desired_phase, p.spec,
            p.spec_version, p.observed_phase, p.observed_version
       FROM workspace_placements p
       JOIN environments e ON e.id = p.environment_id
      WHERE e.kind = 'kubernetes'`,
  )
  return rows
}

interface ObservedUpdate {
  phase: string
  endpoint?: unknown
  message?: string | null
}

/**
 * Write back the observed phase. P0 deliberately does NOT touch observed_version
 * — that is the spec-convergence marker the runner sets only after it applies a
 * spec (P1). Here we only record what we see.
 */
export async function writeObserved(workspaceId: string, o: ObservedUpdate): Promise<void> {
  await pool.query(
    `UPDATE workspace_placements
        SET observed_phase = $2,
            endpoint = $3,
            message = $4,
            reported_at = now()
      WHERE workspace_id = $1`,
    [
      workspaceId,
      o.phase,
      o.endpoint != null ? JSON.stringify(o.endpoint) : null,
      o.message ?? null,
    ],
  )
}
