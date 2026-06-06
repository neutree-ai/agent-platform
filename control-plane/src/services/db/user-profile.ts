import { pool } from './pool'

type UserProfilePayload = Record<string, unknown>

export async function getUserProfile(userId: string): Promise<UserProfilePayload> {
  const { rows } = await pool.query<{ payload: UserProfilePayload }>(
    'SELECT payload FROM user_profile WHERE user_id = $1',
    [userId],
  )
  return rows[0]?.payload ?? {}
}

/**
 * Shallow-merge `patch` into the existing payload (jsonb `||`). Mirrors
 * patchWorkspaceProfile so multiple clients / older versions can write
 * partial keys without clobbering each other.
 */
export async function patchUserProfile(
  userId: string,
  patch: UserProfilePayload,
): Promise<UserProfilePayload> {
  const { rows } = await pool.query<{ payload: UserProfilePayload }>(
    `INSERT INTO user_profile (user_id, payload, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (user_id)
     DO UPDATE SET payload = user_profile.payload || EXCLUDED.payload, updated_at = now()
     RETURNING payload`,
    [userId, JSON.stringify(patch)],
  )
  return rows[0]?.payload ?? {}
}
