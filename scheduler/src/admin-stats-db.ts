import type { PoolClient } from 'pg'
import { pool } from './db'

const RELATIONS = [
  'admin_workspace_stats',
  'admin_daily_stats',
  'user_daily_interactions',
  'admin_token_user_stats',
  'admin_token_workspace_stats',
  'admin_token_daily_stats',
] as const

const INTERACTIONS = `(count(*) FILTER (WHERE m.role = 'user') +
  COALESCE(sum(m.event_count) FILTER (WHERE m.role = 'assistant'), 0))::integer`

export async function refreshAdminStats(forceFullRebuild = false): Promise<void> {
  const { rows } = await pool.query<{ relkind: string }>(
    "SELECT relkind FROM pg_class WHERE oid = to_regclass('public.admin_workspace_stats')",
  )
  if (rows[0]?.relkind === 'm') {
    // The scheduler can be upgraded before the control-plane applies the migration.
    for (const name of RELATIONS) {
      const { rows: views } = await pool.query<{ ispopulated: boolean }>(
        "SELECT ispopulated FROM pg_matviews WHERE schemaname = 'public' AND matviewname = $1",
        [name],
      )
      const concurrently = views[0]?.ispopulated === true ? 'CONCURRENTLY ' : ''
      await pool.query(`REFRESH MATERIALIZED VIEW ${concurrently}public.${name}`)
    }
    return
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ')
    // Serialize ticks and nightly rebuilds before taking the transaction snapshot.
    await client.query('LOCK TABLE public.admin_stats_watermark IN EXCLUSIVE MODE')
    const { rows: state } = await client.query<{ last_usage_id: string }>(
      'SELECT last_usage_id FROM public.admin_stats_watermark WHERE id = 1',
    )
    const fullRebuild = forceFullRebuild || state.length === 0
    await refreshInteractions(client, fullRebuild)
    await refreshTokens(client, fullRebuild, state[0]?.last_usage_id ?? '0')
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function refreshInteractions(client: PoolClient, fullRebuild: boolean): Promise<void> {
  await client.query('DELETE FROM public.admin_workspace_stats')
  await client.query(`
    INSERT INTO public.admin_workspace_stats (workspace_id, interactions)
    SELECT m.workspace_id, ${INTERACTIONS}
      FROM public.messages m GROUP BY m.workspace_id
  `)
  await client.query(
    'DELETE FROM public.admin_daily_stats WHERE $1::boolean OR date >= current_date - 7',
    [fullRebuild],
  )
  await client.query(
    `INSERT INTO public.admin_daily_stats
       (date, new_workspaces, new_sessions, interactions, active_workspaces)
     WITH days AS (
       SELECT d.day
         FROM generate_series(
           (SELECT CASE WHEN $1::boolean THEN min(created_at)::date
                        ELSE greatest(min(created_at)::date, current_date - 7) END
              FROM public.workspaces HAVING min(created_at) IS NOT NULL),
           current_date, interval '1 day') d(day)
     )
     SELECT d.day, COALESCE(w.cnt, 0), COALESCE(s.cnt, 0),
            COALESCE(m.interactions, 0), COALESCE(a.cnt, 0)
       FROM days d
       LEFT JOIN (
         SELECT created_at::date AS day, count(*)::integer AS cnt
           FROM public.workspaces
          WHERE $1::boolean OR created_at >= current_date - 7
          GROUP BY created_at::date
       ) w ON w.day = d.day::date
       LEFT JOIN (
         SELECT created_at::date AS day, count(*)::integer AS cnt
           FROM public.sessions
          WHERE $1::boolean OR created_at >= current_date - 7
          GROUP BY created_at::date
       ) s ON s.day = d.day::date
       LEFT JOIN (
         SELECT m.created_at::date AS day, ${INTERACTIONS} AS interactions
           FROM public.messages m
          WHERE $1::boolean OR m.created_at >= current_date - 7
          GROUP BY m.created_at::date
       ) m ON m.day = d.day::date
       LEFT JOIN (
         SELECT d.day, count(DISTINCT s.workspace_id)::integer AS cnt
           FROM days d
           JOIN public.sessions s ON s.last_active_at >= d.day - interval '6 days'
                                 AND s.last_active_at < d.day + interval '1 day'
          GROUP BY d.day
       ) a ON a.day = d.day`,
    [fullRebuild],
  )
  await client.query(
    'DELETE FROM public.user_daily_interactions WHERE $1::boolean OR day >= current_date - 7',
    [fullRebuild],
  )
  await client.query(
    `INSERT INTO public.user_daily_interactions (user_id, day, interactions)
     SELECT w.user_id, m.created_at::date, ${INTERACTIONS}
       FROM public.messages m
       JOIN public.sessions s ON s.id = m.session_id
       JOIN public.workspaces w ON w.id = s.workspace_id
      WHERE $1::boolean OR m.created_at >= current_date - 7
      GROUP BY w.user_id, m.created_at::date`,
    [fullRebuild],
  )
}

async function refreshTokens(
  client: PoolClient,
  fullRebuild: boolean,
  lastId: string,
): Promise<void> {
  // shortcut: commits delayed beyond the one-minute safety lag are repaired by the nightly rebuild.
  const { rows } = await client.query<{ upper_id: string }>(
    fullRebuild
      ? 'SELECT COALESCE(max(id), 0) AS upper_id FROM public.workspace_usage_events'
      : `SELECT greatest($1::bigint, COALESCE(
           (SELECT min(id) - 1 FROM public.workspace_usage_events
             WHERE created_at >= current_timestamp - interval '1 minute'),
           (SELECT max(id) FROM public.workspace_usage_events), 0)) AS upper_id`,
    fullRebuild ? [] : [lastId],
  )
  const upperId = rows[0].upper_id
  for (const dimension of ['user', 'workspace', 'daily'] as const) {
    const table = `admin_token_${dimension}_stats`
    const key = dimension === 'daily' ? "date_trunc('day', ts)::date" : `${dimension}_id`
    const keyColumn = dimension === 'daily' ? 'day' : key
    const cacheColumn = dimension === 'daily' ? 'cache_write_tokens' : 'cache_creation_tokens'
    if (fullRebuild) await client.query(`DELETE FROM public.${table}`)
    await client.query(
      `INSERT INTO public.${table} AS stats
         (${keyColumn}, input_tokens, output_tokens, cache_read_tokens, ${cacheColumn})
       SELECT ${key}, sum(input_tokens)::bigint, sum(output_tokens)::bigint,
              sum(cache_read_tokens)::bigint, sum(cache_creation_tokens)::bigint
         FROM public.workspace_usage_events
        WHERE ($3::boolean OR id > $1::bigint) AND id <= $2::bigint
              ${dimension === 'daily' ? 'AND ts IS NOT NULL' : ''}
        GROUP BY ${key}
       ON CONFLICT (${keyColumn}) DO UPDATE SET
         input_tokens = stats.input_tokens + EXCLUDED.input_tokens,
         output_tokens = stats.output_tokens + EXCLUDED.output_tokens,
         cache_read_tokens = stats.cache_read_tokens + EXCLUDED.cache_read_tokens,
         ${cacheColumn} = stats.${cacheColumn} + EXCLUDED.${cacheColumn}`,
      [lastId, upperId, fullRebuild],
    )
  }
  await client.query(
    `INSERT INTO public.admin_stats_watermark (id, last_usage_id) VALUES (1, $1)
     ON CONFLICT (id) DO UPDATE SET last_usage_id = EXCLUDED.last_usage_id`,
    [upperId],
  )
}
