// BYOI P2 — environment_tokens service (design §3.2, §9).
//
// Per-environment runner credentials. Mirrors the service-token *mechanics*
// (random secret shown once, SHA-256 hash at rest, Bearer → hash compare,
// revoked_at) but is a SEPARATE table with a SEPARATE, narrower scope: verify
// resolves to an environment id, never a user. The env-auth middleware builds a
// restricted principal from it; every /env/v1 query is forced to that
// environment_id (tenant isolation).

import { createHash, randomBytes } from 'node:crypto'
import { generateId, pool } from './pool'
import type { EnvironmentToken } from './types'

/** Generate a random environment token. Returned to the caller exactly once. */
function generateEnvironmentToken(): string {
  return `env_${randomBytes(32).toString('hex')}`
}

/** Hash a token for storage / lookup (SHA-256). */
function hashEnvironmentToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

interface CreatedEnvironmentToken {
  id: string
  /** Plaintext token — surfaced only here, never stored or returned again. */
  token: string
  created_at: string
}

/** Issue a new token for an environment. Returns the plaintext once. */
export async function createEnvironmentToken(
  environmentId: string,
  name: string,
  createdBy: string,
): Promise<CreatedEnvironmentToken> {
  const id = generateId()
  const token = generateEnvironmentToken()
  const { rows } = await pool.query(
    `INSERT INTO environment_tokens (id, environment_id, name, token_hash, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
    [id, environmentId, name, hashEnvironmentToken(token), createdBy],
  )
  return { id: rows[0].id, token, created_at: rows[0].created_at }
}

/**
 * Verify a raw Bearer token. Returns the bound environment id (the runner's
 * entire authority) or null. Only non-revoked tokens whose environment still
 * exists resolve — the JOIN drops tokens orphaned by a deleted environment.
 */
export async function verifyEnvironmentToken(
  raw: string,
): Promise<{ environmentId: string } | null> {
  if (!raw) return null
  const { rows } = await pool.query(
    `SELECT t.environment_id
       FROM environment_tokens t
       JOIN environments e ON e.id = t.environment_id
      WHERE t.token_hash = $1 AND t.revoked_at IS NULL`,
    [hashEnvironmentToken(raw)],
  )
  return rows[0] ? { environmentId: rows[0].environment_id } : null
}

/** List an environment's tokens (never exposes token_hash). */
export async function listEnvironmentTokens(
  environmentId: string,
): Promise<Omit<EnvironmentToken, 'token_hash'>[]> {
  const { rows } = await pool.query(
    `SELECT id, environment_id, name, created_by, created_at, revoked_at
       FROM environment_tokens
      WHERE environment_id = $1 AND revoked_at IS NULL
      ORDER BY created_at DESC`,
    [environmentId],
  )
  return rows
}

/** Revoke a token. Scoped to its environment so callers can't revoke across envs. */
export async function revokeEnvironmentToken(id: string, environmentId: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE environment_tokens SET revoked_at = NOW()
      WHERE id = $1 AND environment_id = $2 AND revoked_at IS NULL`,
    [id, environmentId],
  )
  return (result.rowCount ?? 0) > 0
}
