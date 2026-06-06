import { randomBytes } from 'node:crypto'
import { pool } from './pool'

interface SessionExportToken {
  token: string
  workspace_id: string
  session_id: string
  expires_at: Date
  created_at: Date
}

/** 128-bit URL-safe token, `sexp_` prefix for at-a-glance recognition in logs. */
function generateToken(): string {
  return `sexp_${randomBytes(16).toString('base64url')}`
}

export async function createSessionExportToken(
  workspaceId: string,
  sessionId: string,
  ttlSeconds: number,
): Promise<SessionExportToken> {
  const token = generateToken()
  const { rows } = await pool.query(
    `INSERT INTO session_export_tokens (token, workspace_id, session_id, expires_at)
     VALUES ($1, $2, $3, NOW() + ($4 || ' seconds')::interval)
     RETURNING *`,
    [token, workspaceId, sessionId, String(ttlSeconds)],
  )
  return rows[0] as SessionExportToken
}

export async function getActiveSessionExportToken(
  token: string,
): Promise<SessionExportToken | null> {
  const { rows } = await pool.query(
    'SELECT * FROM session_export_tokens WHERE token = $1 AND expires_at > NOW()',
    [token],
  )
  return (rows[0] as SessionExportToken) ?? null
}
