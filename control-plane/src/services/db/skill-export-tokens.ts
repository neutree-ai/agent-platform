import { randomBytes } from 'node:crypto'
import { pool } from './pool'

export interface SkillExportToken {
  token: string
  skill_id: string
  user_id: string
  /** Protocol name + on-disk directory name. Frozen at mint time. */
  slug: string
  label: string
  expires_at: Date | null
  last_used_at: Date | null
  created_at: Date
}

/** An export joined with the fields the public registry needs to answer with. */
export interface SkillExportTokenTarget extends SkillExportToken {
  skill_name: string
  skill_description: string
  /** NULL when the skill has never been published — the registry 404s on it. */
  content_hash: string | null
}

/** Default lifetime when the caller doesn't pick one. */
export const DEFAULT_EXPORT_TTL_DAYS = 90

/** 128-bit URL-safe token, `skexp_` prefix for at-a-glance recognition in logs. */
function generateToken(): string {
  return `skexp_${randomBytes(16).toString('base64url')}`
}

/**
 * Mint an export for one skill. Pass `ttlDays = null` for a permanent export;
 * it stays valid until explicitly revoked. There is deliberately no renew —
 * extending a live credential in place makes revocation ambiguous, so the
 * only way to move an expiry is to mint a replacement and delete the old one.
 */
export async function createSkillExportToken(
  skillId: string,
  userId: string,
  slug: string,
  ttlDays: number | null,
  label = '',
): Promise<SkillExportToken> {
  const token = generateToken()
  if (ttlDays == null) {
    const { rows } = await pool.query(
      `INSERT INTO skill_export_tokens (token, skill_id, user_id, slug, label, expires_at)
       VALUES ($1, $2, $3, $4, $5, NULL)
       RETURNING *`,
      [token, skillId, userId, slug, label],
    )
    return rows[0] as SkillExportToken
  }
  const { rows } = await pool.query(
    `INSERT INTO skill_export_tokens (token, skill_id, user_id, slug, label, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' days')::interval)
     RETURNING *`,
    [token, skillId, userId, slug, label, String(ttlDays)],
  )
  return rows[0] as SkillExportToken
}

/**
 * Resolve a token to its skill for the public registry path. Expiry is
 * checked in SQL so an expired export is indistinguishable from a bogus token.
 *
 * Reads the skill's *current* active version — exports follow republishes
 * rather than pinning a snapshot, matching how workspace mounts behave.
 */
export async function getActiveSkillExportToken(
  token: string,
): Promise<SkillExportTokenTarget | null> {
  const { rows } = await pool.query(
    `SELECT ss.*, s.name AS skill_name, s.description AS skill_description,
            sv.content_hash
       FROM skill_export_tokens ss
       JOIN skills s ON s.id = ss.skill_id
       LEFT JOIN skill_versions sv ON sv.id = s.active_version_id
      WHERE ss.token = $1
        AND (ss.expires_at IS NULL OR ss.expires_at > now())`,
    [token],
  )
  return (rows[0] as SkillExportTokenTarget) ?? null
}

/**
 * Stamp last-use. Fire-and-forget from the serving path: a failed stamp must
 * not fail the download, and the value is only ever read by humans deciding
 * which stale export to revoke.
 */
export async function touchSkillExportToken(token: string): Promise<void> {
  try {
    await pool.query('UPDATE skill_export_tokens SET last_used_at = now() WHERE token = $1', [
      token,
    ])
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[skill-exports] last_used_at stamp failed for ${token.slice(0, 12)}…:`, msg)
  }
}

/** List active (non-expired) exports for a skill, newest first. */
export async function listSkillExportTokens(skillId: string): Promise<SkillExportToken[]> {
  const { rows } = await pool.query(
    `SELECT * FROM skill_export_tokens
      WHERE skill_id = $1
        AND (expires_at IS NULL OR expires_at > now())
      ORDER BY created_at DESC`,
    [skillId],
  )
  return rows as SkillExportToken[]
}

/** Hard-delete an export. Returns true if a row was removed. */
export async function deleteSkillExportToken(skillId: string, token: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    'DELETE FROM skill_export_tokens WHERE skill_id = $1 AND token = $2',
    [skillId, token],
  )
  return (rowCount ?? 0) > 0
}

/** Drop expired rows. Called on the hourly maintenance tick below. */
async function cleanupExpiredSkillExportTokens(): Promise<number> {
  const { rowCount } = await pool.query(
    'DELETE FROM skill_export_tokens WHERE expires_at IS NOT NULL AND expires_at <= now()',
  )
  return rowCount ?? 0
}

// Expired exports are already invisible to every read path, so this is purely
// to stop the table growing without bound — export_tokens has no sweep and
// accumulates dead rows for the life of the workspace.
//
// unref'd so it never keeps the process (or a test run) alive.
setInterval(
  () => {
    cleanupExpiredSkillExportTokens()
      .then((n) => {
        if (n > 0) console.log(`[skill-exports] swept ${n} expired export(s)`)
      })
      .catch((err) => console.error('[skill-exports] cleanup error:', err))
  },
  60 * 60 * 1000,
).unref()
