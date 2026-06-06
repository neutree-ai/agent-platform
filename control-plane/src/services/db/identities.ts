import { pool } from './pool'

interface UserIdentity {
  user_id: string
  provider: string
  external_id: string
  display_name: string | null
  metadata: Record<string, unknown>
  created_at: string
}

/** Create a binding between a NAP user and an external identity */
export async function createIdentity(
  userId: string,
  provider: string,
  externalId: string,
  displayName?: string,
  metadata?: Record<string, unknown>,
): Promise<UserIdentity> {
  const { rows } = await pool.query(
    `INSERT INTO user_identities (user_id, provider, external_id, display_name, metadata)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [userId, provider, externalId, displayName ?? null, JSON.stringify(metadata ?? {})],
  )
  return rows[0] as UserIdentity
}

/** Find a NAP user by external identity */
export async function getIdentityByExternal(
  provider: string,
  externalId: string,
): Promise<UserIdentity | null> {
  const { rows } = await pool.query(
    'SELECT * FROM user_identities WHERE provider = $1 AND external_id = $2',
    [provider, externalId],
  )
  return (rows[0] as UserIdentity) ?? null
}

/** List all identities for a user */
export async function listUserIdentities(userId: string): Promise<UserIdentity[]> {
  const { rows } = await pool.query(
    'SELECT * FROM user_identities WHERE user_id = $1 ORDER BY created_at',
    [userId],
  )
  return rows as UserIdentity[]
}

/** Remove a binding */
export async function deleteIdentity(userId: string, provider: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    'DELETE FROM user_identities WHERE user_id = $1 AND provider = $2',
    [userId, provider],
  )
  return (rowCount ?? 0) > 0
}
