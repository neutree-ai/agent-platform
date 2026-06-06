import { Hono } from 'hono'
import type { AppEnv } from '../../lib/types'
import { pool } from '../../services/db/pool'

const stats = new Hono<AppEnv>()

// Refresh matviews in background, at most once every 10 minutes.
let lastMatviewRefresh = 0
function refreshBlockStats() {
  const now = Date.now()
  if (now - lastMatviewRefresh < 10 * 60 * 1000) return
  lastMatviewRefresh = now
  pool
    .query('REFRESH MATERIALIZED VIEW CONCURRENTLY admin_workspace_stats')
    .then(() => pool.query('REFRESH MATERIALIZED VIEW CONCURRENTLY admin_daily_stats'))
    .then(() => pool.query('REFRESH MATERIALIZED VIEW CONCURRENTLY admin_token_user_stats'))
    .then(() => pool.query('REFRESH MATERIALIZED VIEW CONCURRENTLY admin_token_workspace_stats'))
    .then(() => pool.query('REFRESH MATERIALIZED VIEW CONCURRENTLY admin_token_daily_stats'))
    .catch((e) => console.error('[Admin] matview refresh failed:', e))
}

stats.get('/totals', async (c) => {
  refreshBlockStats()
  const result = await pool.query(`
    SELECT
      (SELECT count(*) FROM users WHERE role != 'system')::int AS total_users,
      (SELECT count(DISTINCT w.user_id) FROM workspaces w JOIN sessions s ON s.workspace_id = w.id WHERE s.last_active_at >= current_date - interval '6 days')::int AS weekly_active_users,
      (SELECT count(*) FROM workspaces)::int AS total_agents,
      (SELECT count(DISTINCT workspace_id) FROM sessions WHERE last_active_at >= current_date - interval '6 days')::int AS weekly_active_agents,
      (SELECT count(*) FROM sessions)::int AS total_sessions,
      (SELECT count(*) FROM sessions WHERE created_at >= current_date)::int AS sessions_today,
      (SELECT coalesce(sum(interactions), 0) FROM admin_workspace_stats)::int AS total_interactions,
      (SELECT coalesce(interactions, 0) FROM admin_daily_stats WHERE date = current_date)::int AS interactions_today
  `)
  return c.json(result.rows[0])
})

stats.get('/trends', async (c) => {
  refreshBlockStats()
  const result = await pool.query(`
    WITH base AS (
      SELECT
        coalesce(sum(new_workspaces), 0)::int AS ws_before,
        coalesce(sum(new_sessions), 0)::int AS sess_before,
        coalesce(sum(interactions), 0)::int AS ix_before
      FROM admin_daily_stats
      WHERE date < current_date - interval '29 days'
    ),
    recent AS (
      SELECT *
      FROM admin_daily_stats
      WHERE date >= current_date - interval '29 days'
      ORDER BY date
    )
    SELECT
      recent.date,
      (base.ws_before + sum(recent.new_workspaces) OVER (ORDER BY recent.date))::int AS agents,
      (base.sess_before + sum(recent.new_sessions) OVER (ORDER BY recent.date))::int AS sessions,
      recent.interactions AS daily_interactions,
      (base.ix_before + sum(recent.interactions) OVER (ORDER BY recent.date))::int AS interactions,
      recent.active_workspaces
    FROM recent, base
    ORDER BY recent.date
  `)
  return c.json(
    result.rows.map((r: any) => ({
      date: r.date.toISOString().slice(5, 10),
      sessions: r.sessions,
      agents: r.agents,
      active_agents: r.active_workspaces,
      interactions: r.interactions,
      daily_interactions: r.daily_interactions,
    })),
  )
})

stats.get('/agent-types', async (c) => {
  const result = await pool.query(`
    SELECT agent_type, count(*)::int AS count
    FROM workspace_config
    GROUP BY agent_type
    ORDER BY count DESC
  `)
  return c.json(result.rows)
})

stats.get('/session-sources', async (c) => {
  const result = await pool.query(`
    SELECT source, count(*)::int AS count
    FROM sessions
    GROUP BY source
    ORDER BY count DESC
  `)
  return c.json(result.rows)
})

stats.get('/power-users', async (c) => {
  refreshBlockStats()
  const result = await pool.query(`
    SELECT
      u.display_name AS name,
      count(DISTINCT w.id)::int AS agent_count,
      coalesce(sum(ws.interactions), 0)::int AS interactions
    FROM users u
    JOIN workspaces w ON w.user_id = u.id
    LEFT JOIN admin_workspace_stats ws ON ws.workspace_id = w.id
    WHERE u.role != 'system'
    GROUP BY u.id, u.display_name
    ORDER BY interactions DESC
    LIMIT 15
  `)
  return c.json(result.rows)
})

stats.get('/power-agents', async (c) => {
  refreshBlockStats()
  const result = await pool.query(`
    SELECT
      w.name,
      u.display_name AS owner,
      coalesce(ws.interactions, 0)::int AS interactions,
      (SELECT count(*) FROM sessions s WHERE s.workspace_id = w.id)::int AS session_count
    FROM workspaces w
    JOIN users u ON u.id = w.user_id
    LEFT JOIN admin_workspace_stats ws ON ws.workspace_id = w.id
    ORDER BY interactions DESC
    LIMIT 15
  `)
  return c.json(result.rows)
})

stats.get('/skill-usage', async (c) => {
  // p3: workspace_skills FKs by skill_id (UUID); aggregate by id but project
  // both id and name so the dashboard can label the rows. Names are not
  // globally unique — pair them with id at display time if disambiguation
  // matters.
  const result = await pool.query(`
    SELECT s.id AS skill_id, s.name AS skill_name, count(*)::int AS workspace_count
    FROM workspace_skills ws
    JOIN skills s ON s.id = ws.skill_id
    GROUP BY s.id, s.name
    ORDER BY workspace_count DESC
    LIMIT 10
  `)
  return c.json(result.rows)
})

stats.get('/mcp-usage', async (c) => {
  const result = await pool.query(`
    SELECT key AS server_id, count(*)::int AS workspace_count
    FROM workspace_config,
         jsonb_object_keys(mcp_config::jsonb -> 'mcpServers') AS key
    WHERE mcp_config != '{}'
    GROUP BY key
    ORDER BY workspace_count DESC
    LIMIT 10
  `)
  return c.json(result.rows)
})

// Fleet-wide token usage. The headline total and the top-consumer rankings are
// ALL-TIME (mirroring the admin overview totals and power-user/agent rankings,
// which are lifetime); only the daily trend chart is a recent 30-day window,
// exactly like the interaction trend chart. All time logic uses `ts` (transcript
// activity time), NOT created_at (ingestion time — a first-pull backfill stamps
// history with NOW()).
//
// Served from the admin_token_* matviews (migration 111) instead of the raw
// workspace_usage_events ledger: the all-time aggregates are full-table scans
// that grow linearly with the append-only ledger, so reading the pre-rolled-up
// matviews (refreshed ≤10min via refreshBlockStats, like the other admin
// blocks) keeps the dashboard cheap as the ledger grows. The user/workspace
// names are joined live (small PK joins) so the matviews stay name-free.
const TOKEN_SINCE = "(current_date - interval '29 days')::date"
const TOKEN_ALL_IN =
  '(s.input_tokens + s.output_tokens + s.cache_read_tokens + s.cache_creation_tokens)'

stats.get('/token-usage', async (c) => {
  refreshBlockStats()
  const [overview, daily, topUsers, topAgents] = await Promise.all([
    pool.query(`
      SELECT
        coalesce((SELECT sum(input_tokens + output_tokens + cache_read_tokens + cache_creation_tokens)
                  FROM admin_token_user_stats), 0)::bigint AS total,
        coalesce((SELECT input_tokens + output_tokens + cache_read_tokens + cache_write_tokens
                  FROM admin_token_daily_stats WHERE day = current_date), 0)::bigint AS today
    `),
    pool.query(`
      SELECT d.date::date AS date,
             coalesce(t.input_tokens, 0)::bigint AS input,
             coalesce(t.output_tokens, 0)::bigint AS output,
             coalesce(t.cache_write_tokens, 0)::bigint AS cache_write,
             coalesce(t.cache_read_tokens, 0)::bigint AS cache_read
      FROM generate_series(${TOKEN_SINCE}, current_date, '1 day') AS d(date)
      LEFT JOIN admin_token_daily_stats t ON t.day = d.date
      ORDER BY d.date
    `),
    pool.query(`
      SELECT u.display_name AS name, ${TOKEN_ALL_IN}::bigint AS tokens
      FROM admin_token_user_stats s
      JOIN users u ON u.id = s.user_id
      WHERE u.role != 'system' AND ${TOKEN_ALL_IN} > 0
      ORDER BY tokens DESC
      LIMIT 10
    `),
    pool.query(`
      SELECT w.name, u.display_name AS owner, ${TOKEN_ALL_IN}::bigint AS tokens
      FROM admin_token_workspace_stats s
      JOIN workspaces w ON w.id = s.workspace_id
      JOIN users u ON u.id = w.user_id
      WHERE ${TOKEN_ALL_IN} > 0
      ORDER BY tokens DESC
      LIMIT 10
    `),
  ])
  return c.json({
    total: Number(overview.rows[0].total),
    today: Number(overview.rows[0].today),
    daily: daily.rows.map((r: any) => ({
      date: (r.date instanceof Date ? r.date : new Date(r.date)).toISOString().slice(5, 10),
      input: Number(r.input),
      output: Number(r.output),
      cache_write: Number(r.cache_write),
      cache_read: Number(r.cache_read),
    })),
    topUsers: topUsers.rows.map((r: any) => ({ name: r.name, tokens: Number(r.tokens) })),
    topWorkspaces: topAgents.rows.map((r: any) => ({
      name: r.name,
      owner: r.owner,
      tokens: Number(r.tokens),
    })),
  })
})

export default stats
