/**
 * `session_tokens` — CP-side proxy id for a session. Minted at chat dispatch
 * time, threaded through agent `/chat` body, returned on every MCP request
 * via `X-Session-Token`, and resolved here to attribute the MCP call to a
 * session. See `migrations/088_session_tokens.sql` for the schema rationale
 * and `docs/session-token.md` if/when we add user-facing docs.
 */
import { pool } from '../services/db/pool'

interface SessionTokenRecord {
  token: string
  workspaceId: string
  sessionId: string | null
}

interface MintOpts {
  workspaceId: string
  sessionId?: string | null
}

/**
 * Issue a new token. When `sessionId` is known up-front (resume path that
 * happens to have no existing token row, or any future caller that already
 * has the id) we bind it immediately and stamp `resolved_at` so consumers
 * don't have to wait for `session.started`.
 */
export async function mintToken(opts: MintOpts): Promise<string> {
  const sessionId = opts.sessionId ?? null
  const { rows } = await pool.query<{ token: string }>(
    `INSERT INTO session_tokens (token, workspace_id, session_id, resolved_at)
     VALUES (gen_random_uuid(), $1, $2, CASE WHEN $2::text IS NULL THEN NULL ELSE NOW() END)
     RETURNING token`,
    [opts.workspaceId, sessionId],
  )
  return rows[0].token
}

/**
 * Look up the token already attached to a given session, if any. Used by
 * the resume dispatch path: CP knows the session_id, wants the same token
 * it minted before so the agent sees a stable identity across turns.
 */
async function tokenForSession(sessionId: string): Promise<string | null> {
  const { rows } = await pool.query<{ token: string }>(
    'SELECT token FROM session_tokens WHERE session_id = $1 LIMIT 1',
    [sessionId],
  )
  return rows[0]?.token ?? null
}

/** Reverse lookup from the MCP handler. */
export async function resolveToken(token: string): Promise<SessionTokenRecord | null> {
  const { rows } = await pool.query<{
    token: string
    workspace_id: string
    session_id: string | null
  }>('SELECT token, workspace_id, session_id FROM session_tokens WHERE token = $1 LIMIT 1', [token])
  const row = rows[0]
  if (!row) return null
  return {
    token: row.token,
    workspaceId: row.workspace_id,
    sessionId: row.session_id,
  }
}

/**
 * Reverse lookup with ownership check — returns the record only if the token's
 * workspace belongs to `userId`. Used by the MCP proxy when the route already
 * binds a userId and we must not let a leaked token from another user surface
 * its session_id to a third-party MCP server.
 */
export async function resolveTokenForUser(
  token: string,
  userId: string,
): Promise<SessionTokenRecord | null> {
  const { rows } = await pool.query<{
    token: string
    workspace_id: string
    session_id: string | null
  }>(
    `SELECT st.token, st.workspace_id, st.session_id
       FROM session_tokens st
       JOIN workspaces w ON w.id = st.workspace_id
      WHERE st.token = $1 AND w.user_id = $2
      LIMIT 1`,
    [token, userId],
  )
  const row = rows[0]
  if (!row) return null
  return {
    token: row.token,
    workspaceId: row.workspace_id,
    sessionId: row.session_id,
  }
}

/**
 * Bind a session_id to an existing token. Called from the persist plugin's
 * `session.started` handler once the SDK has revealed the id. Idempotent —
 * a token may receive multiple `session.started` events across reconnects
 * but the bound session_id never changes.
 */
export async function bindSession(token: string, sessionId: string): Promise<void> {
  await pool.query(
    `UPDATE session_tokens
        SET session_id = $1,
            resolved_at = COALESCE(resolved_at, NOW())
      WHERE token = $2
        AND (session_id IS NULL OR session_id = $1)`,
    [sessionId, token],
  )
}

/**
 * Convenience for the resume path: return the existing token for this
 * session or mint a fresh one bound to it. Used by `executeChat` and
 * `call_agent` when the caller hands us an existing `session_id`.
 */
export async function ensureTokenForSession(
  workspaceId: string,
  sessionId: string,
): Promise<string> {
  const existing = await tokenForSession(sessionId)
  if (existing) return existing
  return mintToken({ workspaceId, sessionId })
}
