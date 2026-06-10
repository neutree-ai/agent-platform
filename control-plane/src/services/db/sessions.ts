import { pool } from './pool'
import type {
  PaginatedSessions,
  Session,
  SessionPendingMessage,
  SessionTurnStats,
  SessionWithPreview,
} from './types'

export async function createSession(
  workspaceId: string,
  sessionId: string,
  name = '',
  callerUserId?: string,
  source = 'web',
  callerWorkspaceId?: string | null,
): Promise<Session> {
  await pool.query(
    `INSERT INTO sessions (id, workspace_id, name, caller_user_id, source, caller_workspace_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET last_active_at = NOW()`,
    [sessionId, workspaceId, name, callerUserId ?? null, source, callerWorkspaceId ?? null],
  )
  return (await getSession(sessionId))!
}

export async function getSession(id: string): Promise<Session | null> {
  const { rows } = await pool.query('SELECT * FROM sessions WHERE id = $1', [id])
  return (rows[0] as Session) ?? null
}

export async function listSessions(
  workspaceId: string,
  opts?: { limit?: number; offset?: number; starredOnly?: boolean },
): Promise<PaginatedSessions> {
  const limit = opts?.limit ?? 20
  const offset = opts?.offset ?? 0
  // When set, restricts the list to starred sessions. Filtering happens
  // server-side so "show all my starred" stays complete regardless of how many
  // pages the client has scrolled.
  const starredClause = opts?.starredOnly ? ' AND s.starred_at IS NOT NULL' : ''

  const [{ rows }, countResult] = await Promise.all([
    pool.query(
      `SELECT s.*,
         COALESCE(mc.cnt, 0)::int AS message_count,
         COALESCE(fm.content, '') AS preview,
         cw.name AS caller_agent_name,
         cw.slug AS caller_agent_slug
       FROM sessions s
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS cnt FROM messages m WHERE m.session_id = s.id
       ) mc ON true
       LEFT JOIN LATERAL (
         SELECT content FROM messages m
         WHERE m.session_id = s.id AND m.role = 'user'
         ORDER BY m.created_at ASC LIMIT 1
       ) fm ON true
       LEFT JOIN workspaces cw ON cw.id = s.caller_workspace_id
       WHERE s.workspace_id = $1 AND s.status = 'active'${starredClause}
       ORDER BY s.last_active_at DESC
       LIMIT $2 OFFSET $3`,
      [workspaceId, limit, offset],
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total FROM sessions s
       WHERE s.workspace_id = $1 AND s.status = 'active'${starredClause}`,
      [workspaceId],
    ),
  ])

  return {
    items: rows as SessionWithPreview[],
    total: countResult.rows[0]?.total ?? 0,
  }
}

export async function listSessionsByCaller(
  workspaceId: string,
  callerUserId: string,
): Promise<SessionWithPreview[]> {
  const { rows } = await pool.query(
    `SELECT s.*,
       COALESCE(mc.cnt, 0)::int AS message_count,
       COALESCE(fm.content, '') AS preview,
       cw.name AS caller_agent_name,
       cw.slug AS caller_agent_slug
     FROM sessions s
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS cnt FROM messages m WHERE m.session_id = s.id
     ) mc ON true
     LEFT JOIN LATERAL (
       SELECT content FROM messages m
       WHERE m.session_id = s.id AND m.role = 'user'
       ORDER BY m.created_at ASC LIMIT 1
     ) fm ON true
     LEFT JOIN workspaces cw ON cw.id = s.caller_workspace_id
     WHERE s.workspace_id = $1 AND s.caller_user_id = $2 AND s.status = 'active'
     ORDER BY s.last_active_at DESC`,
    [workspaceId, callerUserId],
  )
  return rows as SessionWithPreview[]
}

export async function updateSessionActivity(sessionId: string): Promise<void> {
  await pool.query('UPDATE sessions SET last_active_at = NOW() WHERE id = $1', [sessionId])
}

export async function renameSession(sessionId: string, name: string): Promise<boolean> {
  const result = await pool.query('UPDATE sessions SET name = $1 WHERE id = $2', [name, sessionId])
  return (result.rowCount ?? 0) > 0
}

/**
 * Star or un-star a session. Stores NOW() when starring, NULL when un-starring,
 * so the starred-at timestamp is available for future ordering/aggregation.
 */
export async function setSessionStarred(sessionId: string, starred: boolean): Promise<boolean> {
  const result = await pool.query(
    'UPDATE sessions SET starred_at = CASE WHEN $1 THEN NOW() ELSE NULL END WHERE id = $2',
    [starred, sessionId],
  )
  return (result.rowCount ?? 0) > 0
}

export async function deleteSession(sessionId: string): Promise<boolean> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM messages WHERE session_id = $1', [sessionId])
    const result = await client.query('DELETE FROM sessions WHERE id = $1', [sessionId])
    await client.query('COMMIT')
    return (result.rowCount ?? 0) > 0
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

export async function updateSessionStats(
  sessionId: string,
  stats: SessionTurnStats,
): Promise<void> {
  await pool.query('UPDATE sessions SET last_turn_stats = $1 WHERE id = $2', [
    JSON.stringify(stats),
    sessionId,
  ])
}

export async function transitionSessionStatus(
  sessionId: string,
  to: 'agent' | 'human' | 'idle',
): Promise<void> {
  await pool.query('UPDATE sessions SET chat_status = $1 WHERE id = $2', [to, sessionId])
}

// ── Pending (queued follow-up) message ───────────────────────────────────
//
// A user can type a follow-up while a turn is still running; it's stashed on
// the session row and drained into a fresh turn once the current turn ends
// cleanly. Single draft per session — re-arming merges into the same row.

/** Replace the session's queued draft outright. */
export async function setPendingMessage(
  sessionId: string,
  msg: SessionPendingMessage,
): Promise<void> {
  await pool.query('UPDATE sessions SET pending_message = $1 WHERE id = $2', [
    JSON.stringify(msg),
    sessionId,
  ])
}

/** Drop the session's queued draft. */
export async function clearPendingMessage(sessionId: string): Promise<void> {
  await pool.query('UPDATE sessions SET pending_message = NULL WHERE id = $1', [sessionId])
}

/**
 * Atomically read-and-clear the queued draft. Returns null if there was none.
 * Atomicity matters: it closes the race where a follow-up PUT lands between a
 * separate read and clear and gets silently dropped.
 *
 * The `prev` CTE snapshots the pre-update value: a plain `UPDATE ... SET
 * pending_message = NULL ... RETURNING pending_message` would return the
 * post-update value (always NULL), silently dropping the drained message.
 */
export async function takePendingMessage(sessionId: string): Promise<SessionPendingMessage | null> {
  const { rows } = await pool.query(
    `WITH prev AS (
       SELECT id, pending_message FROM sessions WHERE id = $1
     )
     UPDATE sessions
        SET pending_message = NULL
       FROM prev
      WHERE sessions.id = prev.id
        AND prev.pending_message IS NOT NULL
      RETURNING prev.pending_message`,
    [sessionId],
  )
  return (rows[0]?.pending_message as SessionPendingMessage) ?? null
}

/**
 * Put a draft back, but only if no newer draft has appeared meanwhile. Used to
 * recover a draft when `takePendingMessage` succeeded but dispatching the turn
 * then failed — a concurrent re-arm by the user wins over the stale value.
 */
export async function restorePendingMessage(
  sessionId: string,
  msg: SessionPendingMessage,
): Promise<void> {
  await pool.query(
    'UPDATE sessions SET pending_message = $1 WHERE id = $2 AND pending_message IS NULL',
    [JSON.stringify(msg), sessionId],
  )
}

export async function resetAllSessionsIdle(workspaceId: string): Promise<void> {
  await pool.query(
    "UPDATE sessions SET chat_status = 'idle' WHERE workspace_id = $1 AND status = 'active' AND chat_status != 'idle'",
    [workspaceId],
  )
}

export async function listActiveSessionIds(workspaceId: string): Promise<string[]> {
  const { rows } = await pool.query(
    "SELECT id FROM sessions WHERE workspace_id = $1 AND status = 'active' AND chat_status = 'agent'",
    [workspaceId],
  )
  return rows.map((r: { id: string }) => r.id)
}

interface RecentSessionItem {
  session_id: string
  workspace_id: string
  workspace_name: string
  session_name: string
  chat_status: string
  preview: string
  last_active_at: string
}

/**
 * Cross-workspace recent sessions for a user. Powers Home's continue-working
 * rail; excludes `chat_status='human'` which is rendered separately as the
 * drain queue. Joins the user's first message for a 40-char preview.
 */
export async function listRecentSessions(
  userId: string,
  limit: number,
): Promise<RecentSessionItem[]> {
  const { rows } = await pool.query(
    `SELECT s.id AS session_id,
            s.workspace_id,
            w.name AS workspace_name,
            s.name AS session_name,
            s.chat_status,
            COALESCE((
              SELECT LEFT(m.content, 40)
              FROM messages m
              WHERE m.session_id = s.id AND m.role = 'user'
              ORDER BY m.created_at ASC
              LIMIT 1
            ), '') AS preview,
            s.last_active_at
       FROM sessions s
       JOIN workspaces w ON w.id = s.workspace_id
      WHERE w.user_id = $1
        AND s.status = 'active'
        AND s.chat_status <> 'human'
      ORDER BY s.last_active_at DESC NULLS LAST
      LIMIT $2`,
    [userId, limit],
  )
  return rows.map((r: any) => ({
    session_id: r.session_id,
    workspace_id: r.workspace_id,
    workspace_name: r.workspace_name,
    session_name: r.session_name ?? '',
    chat_status: r.chat_status,
    preview: r.preview ?? '',
    last_active_at:
      r.last_active_at instanceof Date ? r.last_active_at.toISOString() : String(r.last_active_at),
  }))
}

interface UserActivitySummary {
  /**
   * Per-day counts over the last `days` days, oldest → today. Stat cards
   * and the heatmap both consume this same array.
   *
   * `interactions` follows the platform's matview formula: count of `user`
   * messages plus the sum of session_event blocks attached to `assistant`
   * messages — same nomenclature as the admin dashboard so per-user and
   * platform-wide numbers add up.
   */
  daily: { date: string; interactions: number; sessions: number }[]
  /**
   * Sparse hour × weekday histogram of the user's own messages over the
   * window — answers "when do I work" rather than "how much"; only
   * non-empty buckets are sent. `dow` is 0 (Sun) … 6 (Sat) per Postgres
   * `extract(dow ...)`. Server timezone is implicit (no per-user TZ yet).
   */
  punch_card: { dow: number; hour: number; count: number }[]
}

// Refresh `user_daily_interactions` in the background, at most once every
// 10 min — same debounce as the admin matview refresh. Keeps "today"
// reasonably fresh without slamming the planner on every Stats page load.
let lastUserDailyRefresh = 0
function refreshUserDailyInteractions(): void {
  const now = Date.now()
  if (now - lastUserDailyRefresh < 10 * 60 * 1000) return
  lastUserDailyRefresh = now
  pool
    .query('REFRESH MATERIALIZED VIEW CONCURRENTLY user_daily_interactions')
    .catch((e) => console.error('[Stats] user_daily_interactions refresh failed:', e))
}

/**
 * Per-user activity summary for the Home Stats app. Daily interactions
 * come from the `user_daily_interactions` matview (refreshed lazily on
 * call); session counts and the punch card stay live since they don't
 * touch session_events and are bounded to the requesting user.
 */
export async function getUserActivitySummary(
  userId: string,
  days: number,
): Promise<UserActivitySummary> {
  refreshUserDailyInteractions()
  // Inclusive window: today + (days - 1) prior days = `days` rows.
  const offset = Math.max(0, days - 1)
  const [dailyRes, punchRes] = await Promise.all([
    pool.query(
      `SELECT d.date::date AS date,
              COALESCE(ix.interactions, 0)::int AS interactions,
              COALESCE(sess.cnt, 0)::int AS sessions
         FROM generate_series(
                (current_date - ($2::int * interval '1 day'))::date,
                current_date,
                '1 day'
              ) AS d(date)
         LEFT JOIN user_daily_interactions ix
           ON ix.user_id = $1 AND ix.day = d.date
         LEFT JOIN (
           SELECT date_trunc('day', s.created_at)::date AS day,
                  count(*)::int AS cnt
             FROM sessions s
             JOIN workspaces w ON w.id = s.workspace_id
            WHERE w.user_id = $1
              AND s.created_at >= (current_date - ($2::int * interval '1 day'))::date
            GROUP BY day
         ) sess ON sess.day = d.date
        ORDER BY d.date ASC`,
      [userId, offset],
    ),
    pool.query(
      `SELECT extract(dow FROM m.created_at)::int AS dow,
              extract(hour FROM m.created_at)::int AS hour,
              count(*)::int AS cnt
         FROM messages m
         JOIN sessions s ON s.id = m.session_id
         JOIN workspaces w ON w.id = s.workspace_id
        WHERE w.user_id = $1
          AND m.role = 'user'
          AND m.created_at >= (current_date - ($2::int * interval '1 day'))::date
        GROUP BY dow, hour`,
      [userId, offset],
    ),
  ])
  return {
    daily: dailyRes.rows.map((r: any) => ({
      date:
        r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10),
      interactions: r.interactions,
      sessions: r.sessions,
    })),
    punch_card: punchRes.rows.map((r: any) => ({
      dow: r.dow,
      hour: r.hour,
      count: r.cnt,
    })),
  }
}
