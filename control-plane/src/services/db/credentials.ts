import { pool } from './pool'
import type { UserCredential } from './types'

function encKey(): string {
  const k = process.env.CREDENTIAL_ENCRYPTION_KEY
  if (!k) throw new Error('[CP] CREDENTIAL_ENCRYPTION_KEY is not set')
  return k
}

// List active credentials (metadata only) for the current user, with
// workspace_ids aggregated. Deliberately does NOT decrypt the value — callers
// only need metadata, and pulling plaintext secrets into memory needlessly
// would widen the exposure surface the encryption is meant to shrink.
// GROUP BY the PK lets the other columns ride along as functionally dependent.
export async function listUserCredentials(userId: string): Promise<UserCredential[]> {
  const { rows } = await pool.query(
    `SELECT uc.user_id, uc.name,
            uc.inject, uc.path, uc.mode, uc.scope, uc.status, uc.updated_at,
            COALESCE(
              array_agg(ucw.workspace_id ORDER BY ucw.workspace_id)
                FILTER (WHERE ucw.workspace_id IS NOT NULL),
              ARRAY[]::TEXT[]
            ) AS workspace_ids
     FROM user_credentials uc
     LEFT JOIN user_credential_workspaces ucw
       ON ucw.user_id = uc.user_id AND ucw.credential_name = uc.name
     WHERE uc.user_id = $1 AND uc.status = 'active'
     GROUP BY uc.user_id, uc.name
     ORDER BY uc.name`,
    [userId],
  )
  return rows as UserCredential[]
}

// List credentials applicable to a specific workspace:
// all global ones + selected ones where this workspace is in the scope list.
// Used by the internal agent-facing endpoint.
export async function listWorkspaceCredentials(
  workspaceId: string,
  userId: string,
): Promise<UserCredential[]> {
  const { rows } = await pool.query(
    `SELECT uc.user_id, uc.name,
            pgp_sym_decrypt(decode(uc.encrypted_value, 'base64'), $3) AS value,
            uc.inject, uc.path, uc.mode, uc.scope, uc.status, uc.updated_at
     FROM user_credentials uc
     WHERE uc.user_id = $2
       AND uc.status = 'active'
       AND (
         uc.scope = 'global'
         OR EXISTS (
           SELECT 1 FROM user_credential_workspaces ucw
           WHERE ucw.user_id = uc.user_id
             AND ucw.credential_name = uc.name
             AND ucw.workspace_id = $1
         )
       )
     ORDER BY uc.name`,
    [workspaceId, userId, encKey()],
  )
  return rows as UserCredential[]
}

export async function upsertUserCredential(
  userId: string,
  name: string,
  value: string,
  inject: string,
  path?: string,
  mode?: string,
  scope?: string,
  workspaceIds?: string[],
): Promise<void> {
  const resolvedScope = scope ?? 'global'
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO user_credentials (user_id, name, encrypted_value, inject, path, mode, scope, status)
       VALUES ($1, $2, encode(pgp_sym_encrypt($3, $4), 'base64'), $5, $6, $7, $8, 'active')
       ON CONFLICT (user_id, name) DO UPDATE
         SET encrypted_value = encode(pgp_sym_encrypt($3, $4), 'base64'),
             inject = $5, path = $6, mode = $7, scope = $8, status = 'active', updated_at = NOW()`,
      [userId, name, value, encKey(), inject, path ?? null, mode ?? null, resolvedScope],
    )
    await client.query(
      'DELETE FROM user_credential_workspaces WHERE user_id = $1 AND credential_name = $2',
      [userId, name],
    )
    if (resolvedScope === 'selected' && workspaceIds && workspaceIds.length > 0) {
      for (const wsId of workspaceIds) {
        await client.query(
          `INSERT INTO user_credential_workspaces (user_id, credential_name, workspace_id)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [userId, name, wsId],
        )
      }
    }
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

export async function getUserCredentialValue(userId: string, name: string): Promise<string | null> {
  const { rows } = await pool.query(
    `SELECT pgp_sym_decrypt(decode(encrypted_value, 'base64'), $3) AS value
     FROM user_credentials
     WHERE user_id = $1 AND name = $2 AND status = 'active'`,
    [userId, name, encKey()],
  )
  return rows.length > 0 ? rows[0].value : null
}

export async function softDeleteUserCredential(userId: string, name: string): Promise<boolean> {
  const result = await pool.query(
    "UPDATE user_credentials SET status = 'deleting', updated_at = NOW() WHERE user_id = $1 AND name = $2 AND status = 'active'",
    [userId, name],
  )
  return (result.rowCount ?? 0) > 0
}

export async function hardDeleteUserCredentials(userId: string, names: string[]): Promise<void> {
  if (names.length === 0) return
  const placeholders = names.map((_, i) => `$${i + 2}`).join(', ')
  // user_credential_workspaces rows are removed by ON DELETE CASCADE
  await pool.query(
    `DELETE FROM user_credentials WHERE user_id = $1 AND name IN (${placeholders})`,
    [userId, ...names],
  )
}

// Returns all credentials (metadata only) for a user regardless of status.
// Used by reconcile, which only reads name + status — no value decryption.
export async function listAllUserCredentials(userId: string): Promise<UserCredential[]> {
  const { rows } = await pool.query(
    `SELECT user_id, name, inject, path, mode, scope, status, updated_at
     FROM user_credentials WHERE user_id = $1 ORDER BY name`,
    [userId],
  )
  return rows as UserCredential[]
}

export async function listUsersWithDeletingCredentials(): Promise<string[]> {
  const { rows } = await pool.query(
    "SELECT DISTINCT user_id FROM user_credentials WHERE status = 'deleting'",
  )
  return rows.map((r: { user_id: string }) => r.user_id)
}
