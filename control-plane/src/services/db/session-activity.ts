import { pool } from './pool'

/**
 * Session liveness pulse, coalesced.
 *
 * The SSE tap proves a session is alive on every byte from the agent, throttled
 * to one beat per 10s per session. Sending that straight to Postgres meant one
 * statement — and one commit round-trip through synchronous replication — per
 * live session per beat, which made it the second largest consumer of cumulative
 * execution time in the database.
 *
 * Beats accumulate in memory instead and land as a single multi-row upsert per
 * flush, so the statement count is driven by the flush interval rather than by
 * how many sessions are streaming. Losing up to one interval of beats on a crash
 * is fine: readers coalesce to `sessions.last_active_at`, and the next beat is
 * never more than the throttle window away.
 *
 * Each control-plane replica keeps its own map. A session is served by whichever
 * replica holds its stream, so overlap is rare, and the upsert takes GREATEST to
 * make a late flush from another replica harmless.
 */

const FLUSH_MS = Number(process.env.SESSION_ACTIVITY_FLUSH_MS) || 10_000

const pending = new Map<string, Date>()
let timer: NodeJS.Timeout | null = null

/**
 * Record that `sessionId` is alive now. Returns immediately — the write happens
 * on the next flush. Safe to call on every chunk; callers do not need to
 * throttle for the database's sake, only to bound this map.
 */
export function touchSessionActivity(sessionId: string): void {
  pending.set(sessionId, new Date())
  if (!timer) {
    timer = setInterval(() => void flushSessionActivity(), FLUSH_MS)
    // Don't hold the process open on shutdown for a heartbeat.
    timer.unref()
  }
}

/**
 * Write every pending beat as one statement.
 *
 * The join against `sessions` filters out sessions deleted since their last
 * beat. Without it a single stale id would fail the foreign key and take the
 * whole batch — including every live session in it — down with it.
 */
async function flushSessionActivity(): Promise<void> {
  if (pending.size === 0) return
  const batch = [...pending.entries()]
  pending.clear()

  try {
    await pool.query(
      `INSERT INTO session_activity (session_id, last_active_at)
       SELECT u.id, u.ts
         FROM unnest($1::text[], $2::timestamptz[]) AS u(id, ts)
         JOIN sessions s ON s.id = u.id
       ON CONFLICT (session_id) DO UPDATE
         SET last_active_at = GREATEST(session_activity.last_active_at, EXCLUDED.last_active_at)`,
      [batch.map(([id]) => id), batch.map(([, ts]) => ts)],
    )
  } catch (e) {
    // Dropped beats are recoverable by definition — the next one is one throttle
    // window away, and readers fall back to sessions.last_active_at meanwhile.
    console.error('[SessionActivity] flush failed:', e instanceof Error ? e.message : e)
  }
}
