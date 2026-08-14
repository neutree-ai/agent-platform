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
 *
 * provider_id is read from the workspace's config as it stands at ingest, which
 * is where the tokens were actually spent for all but the workspaces whose
 * provider changed inside the sweep interval. It records which credentials paid
 * for a turn — a user's own key is not the platform's cost — and pulling it here
 * rather than joining later is what keeps the answer once the config is gone.
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
       web_search_requests, speed, fields_incomplete, ts, dedup_key, provider_id
     )
     SELECT $1, $2, x.session_id, x.source, x.model,
            x.input_tokens, x.output_tokens, x.cache_read_tokens, x.cache_creation_tokens,
            x.cache_creation_5m_tokens, x.cache_creation_1h_tokens, x.reasoning_output_tokens,
            x.web_search_requests, x.speed, x.fields_incomplete, x.ts, x.dedup_key,
            (SELECT provider_id FROM workspace_config WHERE workspace_id = $1)
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

/** Token totals over a set of ledger rows. snake_case = the API response shape. */
interface UsageTotals {
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
  cache_creation_5m_tokens: number
  cache_creation_1h_tokens: number
  reasoning_output_tokens: number
  web_search_requests: number
  /** Number of usage records (ledger rows), not conversation turns. */
  record_count: number
}

interface UsageByModel extends UsageTotals {
  source: string
  model: string
}

interface SessionUsage {
  totals: UsageTotals
  by_model: UsageByModel[]
  first_ts: string | null
  last_ts: string | null
}

const EMPTY_TOTALS: UsageTotals = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_tokens: 0,
  cache_creation_tokens: 0,
  cache_creation_5m_tokens: 0,
  cache_creation_1h_tokens: 0,
  reasoning_output_tokens: 0,
  web_search_requests: 0,
  record_count: 0,
}

const TOTAL_KEYS = Object.keys(EMPTY_TOTALS) as (keyof UsageTotals)[]

/**
 * One session's usage, split by the model that spent it and summed across.
 *
 * Split rather than one number because a session is not bound to one model —
 * it survives a core switch, and a fallback can serve part of a run. Comparing
 * what two configurations cost only works if each model's tokens stay
 * separable, and cache reads (routinely tens of times the input volume, at a
 * fraction of the price) have to stay in their own column for the same reason.
 *
 * Scoped by workspace as well as session: the ledger keeps no foreign key, so
 * the workspace is what the caller was authorised against.
 */
export async function getSessionUsage(
  workspaceId: string,
  sessionId: string,
): Promise<SessionUsage> {
  const { rows } = await pool.query(
    `SELECT source, model,
            COALESCE(SUM(input_tokens), 0)::bigint             AS input_tokens,
            COALESCE(SUM(output_tokens), 0)::bigint            AS output_tokens,
            COALESCE(SUM(cache_read_tokens), 0)::bigint        AS cache_read_tokens,
            COALESCE(SUM(cache_creation_tokens), 0)::bigint    AS cache_creation_tokens,
            COALESCE(SUM(cache_creation_5m_tokens), 0)::bigint AS cache_creation_5m_tokens,
            COALESCE(SUM(cache_creation_1h_tokens), 0)::bigint AS cache_creation_1h_tokens,
            COALESCE(SUM(reasoning_output_tokens), 0)::bigint  AS reasoning_output_tokens,
            COALESCE(SUM(web_search_requests), 0)::bigint      AS web_search_requests,
            COUNT(*)::bigint                                   AS record_count,
            MIN(ts) AS first_ts, MAX(ts) AS last_ts
       FROM workspace_usage_events
      WHERE workspace_id = $1 AND session_id = $2
      GROUP BY source, model
      ORDER BY SUM(${ALL_IN}) DESC`,
    [workspaceId, sessionId],
  )

  const totals = { ...EMPTY_TOTALS }
  const by_model: UsageByModel[] = []
  let first: string | null = null
  let last: string | null = null
  for (const r of rows) {
    const bucket = { source: r.source, model: r.model } as UsageByModel
    for (const k of TOTAL_KEYS) {
      const v = Number(r[k])
      bucket[k] = v
      totals[k] += v
    }
    by_model.push(bucket)
    if (r.first_ts && (!first || r.first_ts < first)) first = r.first_ts
    if (r.last_ts && (!last || r.last_ts > last)) last = r.last_ts
  }
  return { totals, by_model, first_ts: first, last_ts: last }
}

/** The raw inputs a completeness verdict is derived from; see services/usage/settle.ts. */
export interface SessionSettlementFacts {
  /**
   * The latest moment cp has any evidence the session was active — its own
   * row, its messages, or its ledger entries. Null when all three are silent.
   */
  activity_at: string | null
  /** When a pull last read this workspace to the end; null if none ever did. */
  drained_through: string | null
  /** 'agent' while a turn runs. Null when the session row is gone. */
  chat_status: string | null
  /** Null when the workspace is gone. Only a running one can still be pulled. */
  workspace_status: string | null
}

export async function getSessionSettlementFacts(
  workspaceId: string,
  sessionId: string,
): Promise<SessionSettlementFacts> {
  // GREATEST ignores NULL arguments in Postgres, so a session with no messages
  // or no ledger rows yet still yields the newest of whatever does exist.
  const { rows } = await pool.query(
    `SELECT
       (SELECT chat_status FROM sessions WHERE id = $2 AND workspace_id = $1) AS chat_status,
       GREATEST(
         (SELECT last_active_at FROM sessions WHERE id = $2 AND workspace_id = $1),
         (SELECT MAX(created_at) FROM messages WHERE session_id = $2 AND workspace_id = $1),
         (SELECT MAX(ts) FROM workspace_usage_events WHERE workspace_id = $1 AND session_id = $2)
       ) AS activity_at,
       (SELECT drained_through FROM workspace_usage_cursor WHERE workspace_id = $1) AS drained_through,
       (SELECT status FROM workspaces WHERE id = $1) AS workspace_status`,
    [workspaceId, sessionId],
  )
  const r = rows[0]
  return {
    activity_at: r?.activity_at ?? null,
    drained_through: r?.drained_through ?? null,
    chat_status: r?.chat_status ?? null,
    workspace_status: r?.workspace_status ?? null,
  }
}

/**
 * Owner recorded on a session's ledger rows, or null if it has none. Lets a
 * caller reach the account of a workspace that has since been deleted, which
 * the ledger deliberately outlives.
 */
export async function getSessionUsageOwner(
  workspaceId: string,
  sessionId: string,
): Promise<string | null> {
  const { rows } = await pool.query(
    'SELECT user_id FROM workspace_usage_events WHERE workspace_id = $1 AND session_id = $2 LIMIT 1',
    [workspaceId, sessionId],
  )
  return rows[0]?.user_id ?? null
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
 * Record that a pull read this workspace's transcripts to the end. Separate
 * from setUsageCursor, which runs per batch and therefore also runs on the
 * batches leading up to a failure — see migration 136 for why the difference
 * matters.
 */
export async function markUsageDrained(workspaceId: string): Promise<void> {
  await pool.query(
    'UPDATE workspace_usage_cursor SET drained_through = NOW() WHERE workspace_id = $1',
    [workspaceId],
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

interface WorkspaceSessionUsage {
  sessionId: string
  name: string
  tokens: number
  /** Messages exchanged — the turn count a user would recognise. */
  messages: number
  /** Tool calls the agent made. Far larger than `messages` when a loop stalls. */
  toolCalls: number
  /** Wall-clock from the session's first to last activity, in seconds. */
  durationSec: number
  lastActiveAt: string | null
}

/**
 * A workspace's sessions ranked by token spend, each with the two signals that
 * explain the spend: how many turns it took and how long it ran. A session with
 * few messages, hundreds of tool calls and hours on the clock is the shape of an
 * agent stuck in a loop — visible here without anything having to judge it.
 *
 * Ranked and truncated before the per-session counts are taken: a busy
 * workspace has thousands of sessions, and counting messages and events for all
 * of them to then show ten is two orders of magnitude of wasted work.
 */
export async function listWorkspaceSessionUsage(
  workspaceId: string,
  days: number,
  limit: number,
): Promise<WorkspaceSessionUsage[]> {
  const offset = Math.max(0, days - 1)
  const { rows } = await pool.query(
    `WITH tok AS (
       SELECT session_id, SUM(${ALL_IN})::bigint AS tokens
         FROM workspace_usage_events
        WHERE workspace_id = $1 AND session_id IS NOT NULL
          AND ts >= (current_date - ($2::int * interval '1 day'))::date
        GROUP BY 1
        ORDER BY 2 DESC
        LIMIT $3
     )
     SELECT tok.session_id, tok.tokens, s.name, s.last_active_at,
            EXTRACT(EPOCH FROM (s.last_active_at - s.created_at))::int AS duration_sec,
            counts.messages, counts.tool_calls
       FROM tok
       JOIN sessions s ON s.id = tok.session_id
       CROSS JOIN LATERAL (
         SELECT (SELECT count(*) FROM messages m WHERE m.session_id = s.id)::int AS messages,
                (SELECT count(*) FROM session_events e
                  WHERE e.session_id = s.id AND e.kind = 'tool_call')::int AS tool_calls
       ) counts
      ORDER BY tok.tokens DESC`,
    [workspaceId, offset, limit],
  )
  return rows.map((r: Record<string, unknown>) => ({
    sessionId: r.session_id as string,
    name: (r.name as string) || '',
    tokens: Number(r.tokens),
    messages: Number(r.messages),
    toolCalls: Number(r.tool_calls),
    durationSec: Math.max(0, Number(r.duration_sec ?? 0)),
    lastActiveAt: r.last_active_at ? (r.last_active_at as Date).toISOString() : null,
  }))
}
