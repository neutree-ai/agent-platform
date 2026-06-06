import { pool } from './pool'
import type { AgentRequest } from './types'

export async function createAgentRequest(data: {
  workspace_id: string
  user_id: string
  kind: string
  payload: Record<string, unknown>
}): Promise<AgentRequest> {
  const { rows } = await pool.query(
    `INSERT INTO agent_requests (workspace_id, user_id, kind, payload)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [data.workspace_id, data.user_id, data.kind, JSON.stringify(data.payload)],
  )
  return (await getAgentRequest(rows[0].id))!
}

export async function getAgentRequest(id: string): Promise<AgentRequest | null> {
  const { rows } = await pool.query('SELECT * FROM agent_requests WHERE id = $1', [id])
  return rows[0] ?? null
}

/**
 * Mark a pending request as approved or rejected. Returns the updated row
 * on success; returns `null` if the request was not pending (already resolved
 * or missing) so the caller can distinguish "stale click" from "ok".
 */
export async function resolveAgentRequest(
  id: string,
  decision: 'approved' | 'rejected',
  reason?: string,
): Promise<AgentRequest | null> {
  const { rows } = await pool.query(
    `UPDATE agent_requests
     SET status = $2,
         reject_reason = $3,
         resolved_at = now()
     WHERE id = $1 AND status = 'pending'
     RETURNING id`,
    [id, decision, decision === 'rejected' ? (reason ?? null) : null],
  )
  if (rows.length === 0) return null
  return await getAgentRequest(id)
}

/**
 * Atomically claim an approved request as `applied`. Returns `true` if the
 * row transitioned from approved → applied, `false` if someone else already
 * applied it (or it's in some other state). Used by the paired `*_apply` MCP
 * tool to prevent duplicate business effects on retry.
 */
export async function markAgentRequestApplied(id: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE agent_requests
     SET status = 'applied', applied_at = now()
     WHERE id = $1 AND status = 'approved'`,
    [id],
  )
  return (rowCount ?? 0) > 0
}
