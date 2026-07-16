import pg from 'pg'

// Bumped above pg's default of 10 to ride out SSE-hang leak bursts that hold
// advisory-lock clients hostage (handler finally never fires when chat SSE
// stalls). Tune via PG_POOL_MAX if the leak rate keeps outpacing it.
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://tos:tos@localhost:5432/tos',
  max: Number(process.env.PG_POOL_MAX) || 50,
})

// --- Schedules ---

interface Schedule {
  id: string
  workspace_id: string
  user_id: string
  name: string
  cron: string | null
  run_at: string | null
  prompt: string
  prompt_id: string | null
  enabled: boolean
}

export async function getSchedule(id: string): Promise<Schedule | null> {
  const { rows } = await pool.query(
    `SELECT s.id, s.workspace_id, s.user_id, s.name, s.cron, s.run_at,
            s.prompt, s.prompt_id, s.enabled,
            p.content AS prompt_content
     FROM schedules s
     LEFT JOIN prompts p ON s.prompt_id = p.id
     WHERE s.id = $1`,
    [id],
  )
  if (!rows[0]) return null
  // Resolve: prefer library prompt content over stored prompt text
  const row = rows[0]
  if (row.prompt_content) {
    row.prompt = row.prompt_content
  }
  row.prompt_content = undefined
  return row
}

export async function updateScheduleLastRun(id: string): Promise<void> {
  await pool.query('UPDATE schedules SET last_run_at = NOW() WHERE id = $1', [id])
}

/** Mark a one-time schedule as fired: set completed_at, disable it, and
 *  clear the queued pg-boss job id (it has executed by now). Disabling on
 *  completion keeps the run-now / re-enable affordances inert for a
 *  terminal row — UI uses `completed_at` as the terminal state, `enabled`
 *  stays consistent with "not going to fire again on its own". */
export async function markScheduleCompleted(id: string): Promise<void> {
  await pool.query(
    `UPDATE schedules
     SET completed_at = NOW(), enabled = false, pgboss_job_id = NULL
     WHERE id = $1`,
    [id],
  )
}

// --- Platform tokens ---

export async function getPlatformToken(userId: string): Promise<string | null> {
  const { rows } = await pool.query(
    'SELECT token FROM service_tokens WHERE created_by = $1 AND is_platform = true AND revoked_at IS NULL',
    [userId],
  )
  return rows[0]?.token ?? null
}

// --- Thread Lock ---

/** Acquire a PG advisory lock scoped to a route+thread pair. The lock is
 *  session-level — it lives on this dedicated connection and is released
 *  when the connection terminates (see releaseThreadLock).
 *
 *  The `error` listener matters: the pool drops its own error handler once a
 *  client is checked out, and this connection then sits parked idle for the
 *  whole SSE turn. Without a listener, a mid-turn drop (PG failover, NAT idle
 *  reap) would surface as an unhandled 'error' and crash the process. */
export async function acquireThreadLock(routeId: string, threadId: string): Promise<pg.PoolClient> {
  const client = await pool.connect()
  client.on('error', (err) => {
    console.error('[Scheduler] Thread-lock connection error:', err)
  })
  await client.query('SELECT pg_advisory_lock($1, $2)', [hashCode(routeId), hashCode(threadId)])
  return client
}

/** Release the advisory lock by destroying its connection. PG drops every
 *  session-level advisory lock held by a backend when that connection
 *  terminates, so `release(true)` (graceful Terminate, no round-trip) both
 *  releases the lock and — unlike an explicit `pg_advisory_unlock` query —
 *  cannot hang on a connection that went zombie while parked for the turn. */
export function releaseThreadLock(client: pg.PoolClient): void {
  client.release(true)
}

function hashCode(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  }
  return h
}

// --- Thread Sessions ---

export async function getThreadSession(
  routeId: string,
  threadId: string,
  sessionTtlHours = 24,
): Promise<{ session_id: string; workspace_id: string } | null> {
  const { rows } = await pool.query(
    `SELECT session_id, workspace_id FROM channel.thread_sessions
     WHERE route_id = $1 AND external_thread_id = $2
       AND last_active_at > NOW() - make_interval(hours => $3)`,
    [routeId, threadId, sessionTtlHours],
  )
  return rows[0] || null
}

export async function upsertThreadSession(
  routeId: string,
  threadId: string,
  sessionId: string,
  workspaceId: string,
  channelId?: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO channel.thread_sessions (id, route_id, external_thread_id, session_id, workspace_id, external_channel_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (route_id, external_thread_id) DO UPDATE SET
       session_id = EXCLUDED.session_id,
       external_channel_id = COALESCE(EXCLUDED.external_channel_id, channel.thread_sessions.external_channel_id),
       last_active_at = NOW()`,
    [crypto.randomUUID(), routeId, threadId, sessionId, workspaceId, channelId ?? null],
  )
}

// --- Batch Runs ---

export async function updateBatchTask(
  id: string,
  updates: { status?: string; session_id?: string; error?: string },
): Promise<void> {
  const sets: string[] = []
  const values: unknown[] = []
  let idx = 1

  if (updates.status !== undefined) {
    sets.push(`status = $${idx++}`)
    values.push(updates.status)
    if (
      updates.status === 'completed' ||
      updates.status === 'failed' ||
      updates.status === 'cancelled'
    ) {
      sets.push('completed_at = NOW()')
    }
  }
  if (updates.session_id !== undefined) {
    sets.push(`session_id = $${idx++}`)
    values.push(updates.session_id)
  }
  if (updates.error !== undefined) {
    sets.push(`error = $${idx++}`)
    values.push(updates.error)
  }

  if (sets.length === 0) return

  values.push(id)
  await pool.query(`UPDATE batch_tasks SET ${sets.join(', ')} WHERE id = $${idx}`, values)
}

export async function checkBatchRunCompletion(batchRunId: string): Promise<{
  all_done: boolean
  stats: {
    total: number
    completed: number
    failed: number
    cancelled: number
    total_cost_usd: number
    total_duration_ms: number
  }
}> {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE bt.status IN ('completed','failed','cancelled'))::int AS done,
       COUNT(*) FILTER (WHERE bt.status = 'completed')::int AS completed,
       COUNT(*) FILTER (WHERE bt.status = 'failed')::int AS failed,
       COUNT(*) FILTER (WHERE bt.status = 'cancelled')::int AS cancelled,
       COALESCE(SUM((s.last_turn_stats->>'costUsd')::numeric), 0)::float AS total_cost_usd,
       COALESCE(SUM((s.last_turn_stats->>'durationMs')::numeric), 0)::float AS total_duration_ms
     FROM batch_tasks bt
     LEFT JOIN sessions s ON s.id = bt.session_id
     WHERE bt.batch_run_id = $1`,
    [batchRunId],
  )
  const row = rows[0]
  return {
    all_done: row.done === row.total,
    stats: {
      total: row.total,
      completed: row.completed,
      failed: row.failed,
      cancelled: row.cancelled,
      total_cost_usd: row.total_cost_usd,
      total_duration_ms: row.total_duration_ms,
    },
  }
}

export async function updateBatchRunStatus(
  id: string,
  status: string,
  stats?: unknown,
): Promise<void> {
  if (status === 'completed' || status === 'failed' || status === 'cancelled') {
    await pool.query(
      'UPDATE batch_runs SET status = $1, stats = $2, completed_at = NOW() WHERE id = $3',
      [status, stats ? JSON.stringify(stats) : null, id],
    )
  } else {
    await pool.query('UPDATE batch_runs SET status = $1 WHERE id = $2', [status, id])
  }
}

export async function getBatchRunConcurrency(batchRunId: string): Promise<number> {
  const { rows } = await pool.query('SELECT concurrency FROM batch_runs WHERE id = $1', [
    batchRunId,
  ])
  return rows[0]?.concurrency ?? 1
}

/** Atomically claim a slot: set task to 'running' only if under concurrency limit. Returns true if claimed. */
export async function tryClaimBatchTask(
  taskId: string,
  batchRunId: string,
  workspaceId: string,
  concurrency: number,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE batch_tasks SET status = 'running'
     WHERE id = $1 AND status = 'queued'
       AND (SELECT COUNT(*) FROM batch_tasks
            WHERE batch_run_id = $2 AND workspace_id = $3 AND status = 'running') < $4`,
    [taskId, batchRunId, workspaceId, concurrency],
  )
  return (rowCount ?? 0) > 0
}

// --- Workspace Concurrency Slots ---

/** Atomically claim a concurrency slot. Returns true if claimed. */
export async function tryClaimWsSlot(workspaceId: string, jobId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `INSERT INTO ws_concurrency_slots (workspace_id, job_id)
     SELECT $1, $2
     WHERE (SELECT COUNT(*) FROM ws_concurrency_slots WHERE workspace_id = $1)
           < (SELECT COALESCE(max_concurrency, 3) FROM workspace_config WHERE workspace_id = $1)
     ON CONFLICT (job_id) DO NOTHING`,
    [workspaceId, jobId],
  )
  return (rowCount ?? 0) > 0
}

/** Release a concurrency slot when job completes. */
export async function releaseWsSlot(jobId: string): Promise<void> {
  await pool.query('DELETE FROM ws_concurrency_slots WHERE job_id = $1', [jobId])
}

/** Time-based backstop for leaked ws concurrency slots: delete any slot held
 *  longer than `olderThanHours`, regardless of its pgboss job state. The
 *  default sits well above the longest legitimate hold — a slot is only held
 *  for executeJob's duration (≤ ~1h: at most two SSE turns, each capped by
 *  runTurn's 30-min idle timeout) — so this never reaps a healthy in-flight
 *  job, only genuinely leaked slots. */
export async function cleanupStaleWsSlots(olderThanHours = 3): Promise<number> {
  const { rowCount } = await pool.query(
    'DELETE FROM ws_concurrency_slots WHERE claimed_at < NOW() - make_interval(hours => $1)',
    [olderThanHours],
  )
  return rowCount ?? 0
}

/** Clean up slots whose pgboss jobs are no longer active (completed, failed, or expired). */
export async function cleanupOrphanedWsSlots(): Promise<number> {
  const { rowCount } = await pool.query(
    `DELETE FROM ws_concurrency_slots s
     WHERE NOT EXISTS (
       SELECT 1 FROM pgboss.job j
       WHERE j.id::text = s.job_id AND j.state IN ('created', 'active', 'retry')
     )`,
  )
  return rowCount ?? 0
}

// --- Event Log Cleanup ---

/** Delete event_log rows older than the given days. */
export async function cleanupOldEventLogs(olderThanDays = 30): Promise<number> {
  const { rowCount } = await pool.query(
    'DELETE FROM channel.event_log WHERE created_at < NOW() - make_interval(days => $1)',
    [olderThanDays],
  )
  return rowCount ?? 0
}

/** Delete thread_sessions rows inactive for longer than the given days. */
export async function cleanupOldThreadSessions(olderThanDays = 7): Promise<number> {
  const { rowCount } = await pool.query(
    'DELETE FROM channel.thread_sessions WHERE last_active_at < NOW() - make_interval(days => $1)',
    [olderThanDays],
  )
  return rowCount ?? 0
}

// --- Admin Stats Matviews ---

/**
 * Refresh the admin dashboard's materialized views. Mirrors the set that
 * control-plane refreshes on-demand in routes/admin/stats.ts — keep the two
 * lists in sync when a matview is added or removed.
 *
 * CONCURRENTLY keeps the dashboard readable during the refresh (no exclusive
 * lock on the matview) and cannot run inside a transaction — so these go one
 * per query on the pool, never wrapped in BEGIN/COMMIT. Sequential on purpose:
 * the token matviews are cheap relative to the base ones and ordering keeps the
 * lock footprint predictable.
 */
export async function refreshAdminMatviews(): Promise<void> {
  await refreshMatview('admin_workspace_stats')
  await refreshMatview('admin_daily_stats')
  await refreshMatview('admin_token_user_stats')
  await refreshMatview('admin_token_workspace_stats')
  await refreshMatview('admin_token_daily_stats')
}

/**
 * Refresh one matview, using CONCURRENTLY only once it has been populated.
 * The base schema creates these matviews `WITH NO DATA`, and Postgres rejects
 * `REFRESH MATERIALIZED VIEW CONCURRENTLY` on a never-populated matview — so on
 * a fresh install the first refresh must be plain, or the view stays empty
 * forever and every read errors with "has not been populated". Once populated,
 * CONCURRENTLY keeps the dashboard readable during the rebuild. `name` comes
 * from the fixed caller list above, never user input — safe to interpolate.
 */
async function refreshMatview(name: string): Promise<void> {
  const { rows } = await pool.query<{ ispopulated: boolean }>(
    'SELECT ispopulated FROM pg_matviews WHERE matviewname = $1',
    [name],
  )
  const concurrently = rows[0]?.ispopulated === true ? 'CONCURRENTLY ' : ''
  await pool.query(`REFRESH MATERIALIZED VIEW ${concurrently}${name}`)
}

// --- Session Title Generation ---

/** Read the system-level title-gen config from the single system_settings row. */
export async function getTitleGenSettings(): Promise<{
  activeProvider: string | null
  providers: Record<string, unknown>
}> {
  const { rows } = await pool.query(
    'SELECT titlegen_active_provider, titlegen_providers FROM system_settings WHERE id = 1',
  )
  const row = rows[0] ?? {}
  return {
    activeProvider: row.titlegen_active_provider ?? null,
    providers: row.titlegen_providers ?? {},
  }
}

interface TitleGenCandidate {
  id: string
  first_user_message: string
}

/**
 * Active sessions that still have an empty name but already contain a completed
 * exchange (a first user message and at least one assistant reply). Restricted
 * to sessions quiet for `quietSeconds` so we don't title a half-finished first
 * turn. Returns the session id plus its first user message (the title source).
 */
export async function getTitleGenCandidates(
  limit: number,
  quietSeconds: number,
): Promise<TitleGenCandidate[]> {
  const { rows } = await pool.query(
    `SELECT s.id, fm.content AS first_user_message
       FROM sessions s
       JOIN LATERAL (
         SELECT content FROM messages m
         WHERE m.session_id = s.id AND m.role = 'user'
         ORDER BY m.created_at ASC LIMIT 1
       ) fm ON true
      WHERE s.name = ''
        AND s.status = 'active'
        AND s.last_active_at < now() - make_interval(secs => $1)
        AND EXISTS (
          SELECT 1 FROM messages m
          WHERE m.session_id = s.id AND m.role = 'assistant'
        )
      ORDER BY s.last_active_at DESC
      LIMIT $2`,
    [quietSeconds, limit],
  )
  return rows as TitleGenCandidate[]
}

/**
 * Set a session's title, but only if it is still empty. The `name = ''` guard
 * makes concurrent titling (another scheduler replica, or a user rename)
 * idempotent — a late writer is a no-op.
 */
export async function setSessionTitleIfEmpty(sessionId: string, title: string): Promise<void> {
  await pool.query(`UPDATE sessions SET name = $1 WHERE id = $2 AND name = ''`, [title, sessionId])
}
