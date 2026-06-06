import { generateId, pool } from './pool'
import type { ServiceToken, Share } from './types'

export async function createShare(
  userId: string,
  workspaceId: string,
  sessionId: string,
  title: string,
  data: unknown,
): Promise<Share> {
  const id = generateId()
  await pool.query(
    'INSERT INTO shares (id, user_id, workspace_id, session_id, title, data) VALUES ($1, $2, $3, $4, $5, $6)',
    [
      id,
      userId,
      workspaceId,
      sessionId,
      title,
      JSON.stringify(data, (_k, v) => (typeof v === 'string' ? v.replace(/\0/g, '') : v)),
    ],
  )
  return (await getShare(id))!
}

async function getShare(id: string): Promise<Share | null> {
  const { rows } = await pool.query('SELECT * FROM shares WHERE id = $1', [id])
  return (rows[0] as Share) ?? null
}

export async function getShareWithOwner(
  id: string,
): Promise<(Share & { owner_name: string }) | null> {
  const { rows } = await pool.query(
    `SELECT s.*, u.display_name AS owner_name
     FROM shares s JOIN users u ON u.id = s.user_id
     WHERE s.id = $1`,
    [id],
  )
  return (rows[0] as Share & { owner_name: string }) ?? null
}

export async function listSharesBySession(
  workspaceId: string,
  sessionId: string,
): Promise<Share[]> {
  const { rows } = await pool.query(
    'SELECT * FROM shares WHERE workspace_id = $1 AND session_id = $2 ORDER BY created_at DESC',
    [workspaceId, sessionId],
  )
  return rows as Share[]
}

export async function listSharesByWorkspace(workspaceId: string): Promise<Share[]> {
  const { rows } = await pool.query(
    'SELECT * FROM shares WHERE workspace_id = $1 ORDER BY created_at DESC',
    [workspaceId],
  )
  return rows as Share[]
}

export async function updateShareTitle(
  id: string,
  userId: string,
  title: string,
): Promise<boolean> {
  const result = await pool.query('UPDATE shares SET title = $1 WHERE id = $2 AND user_id = $3', [
    title,
    id,
    userId,
  ])
  return (result.rowCount ?? 0) > 0
}

export async function deleteShare(id: string, userId: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM shares WHERE id = $1 AND user_id = $2', [id, userId])
  return (result.rowCount ?? 0) > 0
}

// Service token operations

export async function createServiceToken(
  name: string,
  tokenHash: string,
  createdBy: string,
): Promise<{ id: string; created_at: string }> {
  const id = generateId()
  const { rows } = await pool.query(
    'INSERT INTO service_tokens (id, name, token_hash, created_by) VALUES ($1, $2, $3, $4) RETURNING id, created_at',
    [id, name, tokenHash, createdBy],
  )
  return rows[0]
}

export async function getServiceTokenByHash(tokenHash: string): Promise<ServiceToken | null> {
  const { rows } = await pool.query(
    'SELECT * FROM service_tokens WHERE token_hash = $1 AND revoked_at IS NULL',
    [tokenHash],
  )
  return rows[0] || null
}

export async function listServiceTokens(
  userId?: string,
): Promise<Omit<ServiceToken, 'token_hash'>[]> {
  if (userId) {
    const { rows } = await pool.query(
      'SELECT id, name, created_by, created_at, revoked_at, is_platform FROM service_tokens WHERE revoked_at IS NULL AND created_by = $1 ORDER BY is_platform ASC, created_at DESC',
      [userId],
    )
    return rows
  }
  const { rows } = await pool.query(
    'SELECT id, name, created_by, created_at, revoked_at, is_platform FROM service_tokens WHERE revoked_at IS NULL ORDER BY created_at DESC',
  )
  return rows
}

export async function revokeServiceToken(id: string): Promise<boolean> {
  const result = await pool.query(
    'UPDATE service_tokens SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL AND is_platform = false',
    [id],
  )
  return (result.rowCount ?? 0) > 0
}

/** Get or create the platform service token for a user. Returns plaintext token. */
export async function ensurePlatformToken(userId: string): Promise<string> {
  const { rows } = await pool.query(
    'SELECT token FROM service_tokens WHERE created_by = $1 AND is_platform = true AND revoked_at IS NULL',
    [userId],
  )
  if (rows.length > 0) return rows[0].token

  const { generateToken, hashToken } = await import('../../lib/service-token')
  const token = generateToken()
  const id = generateId()
  await pool.query(
    `INSERT INTO service_tokens (id, name, token_hash, token, created_by, is_platform)
     VALUES ($1, $2, $3, $4, $5, true)
     ON CONFLICT DO NOTHING`,
    [id, '__platform__', hashToken(token), token, userId],
  )
  const { rows: check } = await pool.query(
    'SELECT token FROM service_tokens WHERE created_by = $1 AND is_platform = true AND revoked_at IS NULL',
    [userId],
  )
  return check[0].token
}

/** Get the platform token plaintext for a user (if exists). */
export async function getPlatformToken(userId: string): Promise<string | null> {
  const { rows } = await pool.query(
    'SELECT token FROM service_tokens WHERE created_by = $1 AND is_platform = true AND revoked_at IS NULL',
    [userId],
  )
  return rows[0]?.token ?? null
}
