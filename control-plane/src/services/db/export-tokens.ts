import { randomBytes } from 'node:crypto'
import { pool } from './pool'

type ExportKind = 'file' | 'dir'

export interface ExportToken {
  token: string
  workspace_id: string
  path: string
  /** 'dir' tokens are served as a zip archive; 'file' as a single-file proxy. */
  kind: ExportKind
  expires_at: Date | null
  created_at: Date
}

/** 128-bit URL-safe token, `exp_` prefix for at-a-glance recognition in logs. */
function generateToken(): string {
  return `exp_${randomBytes(16).toString('base64url')}`
}

/**
 * Mint a new token. Pass `ttlSeconds = null` to mint a permanent token
 * (NULL expires_at). Permanent tokens stay valid until explicitly revoked.
 */
export async function createExportToken(
  workspaceId: string,
  path: string,
  ttlSeconds: number | null,
  kind: ExportKind = 'file',
): Promise<ExportToken> {
  const token = generateToken()
  if (ttlSeconds == null) {
    const { rows } = await pool.query(
      `INSERT INTO export_tokens (token, workspace_id, path, kind, expires_at)
       VALUES ($1, $2, $3, $4, NULL)
       RETURNING *`,
      [token, workspaceId, path, kind],
    )
    return rows[0] as ExportToken
  }
  const { rows } = await pool.query(
    `INSERT INTO export_tokens (token, workspace_id, path, kind, expires_at)
     VALUES ($1, $2, $3, $4, now() + ($5 || ' seconds')::interval)
     RETURNING *`,
    [token, workspaceId, path, kind, String(ttlSeconds)],
  )
  return rows[0] as ExportToken
}

export async function getActiveExportToken(token: string): Promise<ExportToken | null> {
  const { rows } = await pool.query(
    'SELECT * FROM export_tokens WHERE token = $1 AND (expires_at IS NULL OR expires_at > now())',
    [token],
  )
  return (rows[0] as ExportToken) ?? null
}

/** List active (non-expired) tokens for a workspace, newest first. */
export async function listExportTokens(workspaceId: string): Promise<ExportToken[]> {
  const { rows } = await pool.query(
    `SELECT * FROM export_tokens
      WHERE workspace_id = $1
        AND (expires_at IS NULL OR expires_at > now())
      ORDER BY created_at DESC`,
    [workspaceId],
  )
  return rows as ExportToken[]
}

/** Hard-delete a token. Returns true if a row was removed. */
export async function deleteExportToken(workspaceId: string, token: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    'DELETE FROM export_tokens WHERE workspace_id = $1 AND token = $2',
    [workspaceId, token],
  )
  return (rowCount ?? 0) > 0
}
