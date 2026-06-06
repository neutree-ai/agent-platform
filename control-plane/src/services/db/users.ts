import { generateId, pool } from './pool'
import type { User } from './types'

export async function upsertUser(
  username: string,
  displayName: string,
  email?: string,
): Promise<User> {
  const existing = await getUserByUsername(username)
  const now = new Date().toISOString()

  if (existing) {
    await pool.query(
      'UPDATE users SET display_name = $1, email = $2, last_login_at = $3 WHERE id = $4',
      [displayName, email || null, now, existing.id],
    )
    return (await getUser(existing.id))!
  }

  const id = generateId()
  await pool.query(
    'INSERT INTO users (id, username, display_name, email, last_login_at) VALUES ($1, $2, $3, $4, $5)',
    [id, username, displayName, email || null, now],
  )
  return (await getUser(id))!
}

export async function getUser(id: string): Promise<User | null> {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id])
  return (rows[0] as User) ?? null
}

export async function getUserByUsername(username: string): Promise<User | null> {
  const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username])
  return (rows[0] as User) ?? null
}

export async function listUsers(): Promise<User[]> {
  const { rows } = await pool.query(
    "SELECT * FROM users WHERE role != 'system' ORDER BY created_at DESC",
  )
  return rows as User[]
}

export async function createUser(
  username: string,
  displayName: string,
  passwordHash: string,
  email?: string,
  role: 'user' | 'admin' = 'user',
): Promise<User> {
  const id = generateId()
  await pool.query(
    'INSERT INTO users (id, username, display_name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5, $6)',
    [id, username, displayName, email || null, passwordHash, role],
  )
  return (await getUser(id))!
}

export async function setUserPassword(userId: string, passwordHash: string): Promise<void> {
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId])
}

export async function deleteUser(userId: string): Promise<void> {
  await pool.query('DELETE FROM service_tokens WHERE created_by = $1', [userId])
  await pool.query('DELETE FROM users WHERE id = $1', [userId])
}

export async function setUserDefaultPrompt(userId: string, promptId: string | null): Promise<void> {
  await pool.query('UPDATE users SET default_prompt_id = $1 WHERE id = $2', [promptId, userId])
}

export async function setUserAutoEvolution(userId: string, enabled: boolean): Promise<void> {
  await pool.query('UPDATE users SET auto_evolution = $1 WHERE id = $2', [enabled, userId])
}
