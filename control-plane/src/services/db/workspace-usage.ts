import type { SweepCursors, UsageRecord } from '../../../../internal/agent-usage/src/index'
import { pool } from './pool'

/**
 * Per-workspace token-usage ledger access. The ledger is append-only and
 * immutable (see migration 109); ingestion is idempotent via UNIQUE(dedup_key).
 */

/** A ledger row as written, derived purely from a UsageRecord + attribution. */
interface UsageRow {
  session_id: string | null
  source: string
  model: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
  cache_creation_5m_tokens: number
  cache_creation_1h_tokens: number
  reasoning_output_tokens: number
  web_search_requests: number
  speed: string | null
  fields_incomplete: boolean
  ts: string | null
  dedup_key: string
}

/** Map an agent-usage record to a ledger row. */
function toUsageRow(r: UsageRecord): UsageRow {
  return {
    session_id: r.sessionId || null,
    source: r.source,
    model: r.model,
    input_tokens: r.inputTokens,
    output_tokens: r.outputTokens,
    cache_read_tokens: r.cacheReadTokens,
    cache_creation_tokens: r.cacheCreationTokens,
    cache_creation_5m_tokens: r.cacheCreation5mTokens,
    cache_creation_1h_tokens: r.cacheCreation1hTokens,
    reasoning_output_tokens: r.reasoningTokens,
    web_search_requests: r.webSearchRequests,
    speed: r.speed,
    fields_incomplete: r.fieldsIncomplete,
    ts: r.ts || null,
    dedup_key: r.dedupKey,
  }
}

/**
 * Append usage records to the ledger. workspace_id/user_id are the attribution
 * snapshot (the pod is the workspace). Returns the number of rows actually
 * inserted (duplicates are silently skipped via ON CONFLICT).
 */
export async function insertUsageRecords(
  workspaceId: string,
  userId: string,
  records: UsageRecord[],
): Promise<number> {
  if (records.length === 0) return 0
  const rows = records.map(toUsageRow)
  const { rowCount } = await pool.query(
    `INSERT INTO workspace_usage_events (
       workspace_id, user_id, session_id, source, model,
       input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
       cache_creation_5m_tokens, cache_creation_1h_tokens, reasoning_output_tokens,
       web_search_requests, speed, fields_incomplete, ts, dedup_key
     )
     SELECT $1, $2, x.session_id, x.source, x.model,
            x.input_tokens, x.output_tokens, x.cache_read_tokens, x.cache_creation_tokens,
            x.cache_creation_5m_tokens, x.cache_creation_1h_tokens, x.reasoning_output_tokens,
            x.web_search_requests, x.speed, x.fields_incomplete, x.ts, x.dedup_key
     FROM jsonb_to_recordset($3::jsonb) AS x(
       session_id TEXT, source TEXT, model TEXT,
       input_tokens BIGINT, output_tokens BIGINT, cache_read_tokens BIGINT, cache_creation_tokens BIGINT,
       cache_creation_5m_tokens BIGINT, cache_creation_1h_tokens BIGINT, reasoning_output_tokens BIGINT,
       web_search_requests INT, speed TEXT, fields_incomplete BOOLEAN, ts TIMESTAMPTZ, dedup_key TEXT
     )
     ON CONFLICT (dedup_key) DO NOTHING`,
    [workspaceId, userId, JSON.stringify(rows)],
  )
  return rowCount ?? 0
}

/** Aggregate totals, snake_case to match the API response shape (no remap at the route). */
interface WorkspaceUsageTotals {
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
  reasoning_output_tokens: number
  web_search_requests: number
  /** Number of usage records (ledger rows), not conversation turns. */
  record_count: number
  last_used_at: string | null
}

/** Aggregate totals for a workspace, summed live over the ledger. */
export async function getWorkspaceUsageTotals(workspaceId: string): Promise<WorkspaceUsageTotals> {
  const { rows } = await pool.query(
    `SELECT
       COALESCE(SUM(input_tokens), 0)::bigint            AS input_tokens,
       COALESCE(SUM(output_tokens), 0)::bigint           AS output_tokens,
       COALESCE(SUM(cache_read_tokens), 0)::bigint       AS cache_read_tokens,
       COALESCE(SUM(cache_creation_tokens), 0)::bigint   AS cache_creation_tokens,
       COALESCE(SUM(reasoning_output_tokens), 0)::bigint AS reasoning_output_tokens,
       COALESCE(SUM(web_search_requests), 0)::bigint     AS web_search_requests,
       COUNT(*)::bigint                                  AS record_count,
       MAX(created_at)                                   AS last_used_at
     FROM workspace_usage_events
     WHERE workspace_id = $1`,
    [workspaceId],
  )
  const r = rows[0]
  // pg returns bigint as string; coerce the summed columns to numbers.
  return {
    input_tokens: Number(r.input_tokens),
    output_tokens: Number(r.output_tokens),
    cache_read_tokens: Number(r.cache_read_tokens),
    cache_creation_tokens: Number(r.cache_creation_tokens),
    reasoning_output_tokens: Number(r.reasoning_output_tokens),
    web_search_requests: Number(r.web_search_requests),
    record_count: Number(r.record_count),
    last_used_at: r.last_used_at ?? null,
  }
}

export async function getUsageCursor(workspaceId: string): Promise<SweepCursors> {
  const { rows } = await pool.query(
    'SELECT cursor FROM workspace_usage_cursor WHERE workspace_id = $1',
    [workspaceId],
  )
  return (rows[0]?.cursor as SweepCursors) ?? {}
}

export async function setUsageCursor(workspaceId: string, cursor: SweepCursors): Promise<void> {
  await pool.query(
    `INSERT INTO workspace_usage_cursor (workspace_id, cursor, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (workspace_id) DO UPDATE SET cursor = EXCLUDED.cursor, updated_at = NOW()`,
    [workspaceId, JSON.stringify(cursor)],
  )
}

/**
 * Per-user token-usage summary for the Stats app, over the last `days` days.
 * Aggregates the ledger directly by user_id (the events carry it), so it spans
 * all of the user's workspaces. The "all-in" token is input+output+cache —
 * total volume; the composition split lets the UI show that cache-read tokens
 * dominate volume but are cheap. byWorkspace is the per-agent breakdown (top N).
 */
interface UserUsageSummary {
  /** Daily all-in token totals, one row per day in the window (zero-filled). */
  daily: { date: string; tokens: number }[]
  /** Period totals split by token kind, for the composition bar. */
  composition: { input: number; output: number; cacheRead: number; cacheCreation: number }
  /** Top workspaces by all-in token this period. */
  byWorkspace: { workspaceId: string; name: string; tokens: number }[]
}

// All-in token volume of a ledger row (alias `e` for the joined query).
const ALL_IN = 'input_tokens + output_tokens + cache_read_tokens + cache_creation_tokens'
const ALL_IN_E = 'e.input_tokens + e.output_tokens + e.cache_read_tokens + e.cache_creation_tokens'

export async function getUserUsageSummary(userId: string, days: number): Promise<UserUsageSummary> {
  // Inclusive window: today + (days - 1) prior days = `days` rows (matches the
  // activity summary's convention so both react to the same range picker).
  const offset = Math.max(0, days - 1)
  const since = `(current_date - ($2::int * interval '1 day'))::date`
  // Bucket/window by `ts` (the transcript's activity time), NOT `created_at`
  // (the ingestion time — a first-pull backfill stamps every historical record
  // with NOW(), so created_at would pile all history onto the rollout day).
  const [dailyRes, compRes, wsRes] = await Promise.all([
    pool.query(
      `SELECT d.date::date AS date, COALESCE(u.tokens, 0)::bigint AS tokens
         FROM generate_series(${since}, current_date, '1 day') AS d(date)
         LEFT JOIN (
           SELECT date_trunc('day', ts)::date AS day,
                  SUM(${ALL_IN})::bigint AS tokens
             FROM workspace_usage_events
            WHERE user_id = $1 AND ts >= ${since}
            GROUP BY day
         ) u ON u.day = d.date
        ORDER BY d.date ASC`,
      [userId, offset],
    ),
    pool.query(
      `SELECT COALESCE(SUM(input_tokens), 0)::bigint          AS input,
              COALESCE(SUM(output_tokens), 0)::bigint         AS output,
              COALESCE(SUM(cache_read_tokens), 0)::bigint     AS cache_read,
              COALESCE(SUM(cache_creation_tokens), 0)::bigint AS cache_creation
         FROM workspace_usage_events
        WHERE user_id = $1 AND ts >= ${since}`,
      [userId, offset],
    ),
    pool.query(
      `SELECT e.workspace_id, w.name, SUM(${ALL_IN_E})::bigint AS tokens
         FROM workspace_usage_events e
         JOIN workspaces w ON w.id = e.workspace_id
        WHERE e.user_id = $1 AND e.ts >= ${since}
        GROUP BY e.workspace_id, w.name
        HAVING SUM(${ALL_IN_E}) > 0
        ORDER BY tokens DESC
        LIMIT 8`,
      [userId, offset],
    ),
  ])
  const c = compRes.rows[0]
  return {
    daily: dailyRes.rows.map((r: { date: Date | string; tokens: string }) => ({
      date:
        r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10),
      tokens: Number(r.tokens),
    })),
    composition: {
      input: Number(c.input),
      output: Number(c.output),
      cacheRead: Number(c.cache_read),
      cacheCreation: Number(c.cache_creation),
    },
    byWorkspace: wsRes.rows.map((r: { workspace_id: string; name: string; tokens: string }) => ({
      workspaceId: r.workspace_id,
      name: r.name,
      tokens: Number(r.tokens),
    })),
  }
}
