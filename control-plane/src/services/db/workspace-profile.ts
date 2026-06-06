import { pool } from './pool'

type WorkspaceProfilePayload = Record<string, unknown>

export async function getWorkspaceProfile(workspaceId: string): Promise<WorkspaceProfilePayload> {
  const { rows } = await pool.query<{ payload: WorkspaceProfilePayload }>(
    'SELECT payload FROM workspace_profile WHERE workspace_id = $1',
    [workspaceId],
  )
  return rows[0]?.payload ?? {}
}

/**
 * Shallow-merge `patch` into the existing payload (jsonb `||`). Unknown
 * top-level keys written by other clients/versions are preserved.
 */
export async function patchWorkspaceProfile(
  workspaceId: string,
  patch: WorkspaceProfilePayload,
): Promise<WorkspaceProfilePayload> {
  const { rows } = await pool.query<{ payload: WorkspaceProfilePayload }>(
    `INSERT INTO workspace_profile (workspace_id, payload, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (workspace_id)
     DO UPDATE SET payload = workspace_profile.payload || EXCLUDED.payload, updated_at = now()
     RETURNING payload`,
    [workspaceId, JSON.stringify(patch)],
  )
  return rows[0]?.payload ?? {}
}
