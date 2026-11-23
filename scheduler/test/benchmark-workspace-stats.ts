// Run with TEST_DATABASE_URL pointing to a disposable server:
// npx tsx test/benchmark-workspace-stats.ts
// Creates and drops its own database; measures only the workspace interaction step.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { mock } from 'node:test'
import pg from 'pg'

const testUrl = process.env.TEST_DATABASE_URL
if (!testUrl) throw new Error('Set TEST_DATABASE_URL to a server with CREATE DATABASE permission')
const admin = new pg.Client({ connectionString: testUrl })
await admin.connect()
const database = `stats_bench_${randomUUID().replaceAll('-', '')}`
await admin.query(`CREATE DATABASE "${database}"`)
const url = new URL(testUrl)
url.pathname = `/${database}`
process.env.DATABASE_URL = url.toString()
const { pool } = await import('../src/db')
const { refreshAdminStats } = await import('../src/admin-stats-db')
const fixture = new pg.Client({ connectionString: url.toString() })
await fixture.connect()

try {
  const migrations = new URL('../../control-plane/migrations/', import.meta.url)
  const migrate = async (name: string) => {
    await fixture.query('BEGIN')
    await fixture.query(await readFile(new URL(name, migrations), 'utf8'))
    await fixture.query('RESET search_path')
    await fixture.query('COMMIT')
  }
  for (const name of (await readdir(migrations)).filter((name) => name.endsWith('.sql')).sort()) {
    if (name < '157_') await migrate(name)
  }
  await fixture.query(`
    INSERT INTO users (id, username, display_name) VALUES ('bench', 'bench', 'Benchmark');
    INSERT INTO workspaces (id, user_id, name, created_at)
      SELECT 'w' || i, 'bench', 'Benchmark', current_date - 190 FROM generate_series(0, 999) g(i);
    INSERT INTO sessions (id, workspace_id, created_at, last_active_at)
      SELECT id, id, created_at, current_date FROM workspaces;
    INSERT INTO messages (id, workspace_id, session_id, role, content, created_at, event_count)
      SELECT 'm' || i, 'w' || ((i - 1) % 1000), 'w' || ((i - 1) % 1000),
             CASE WHEN i % 2 = 0 THEN 'user' ELSE 'assistant' END, repeat('x', 550),
             CASE WHEN i <= 590000 THEN current_date - 8 - ((i - 1) / 1000 % 180)
                  ELSE current_date - ((i - 590001) / 1000 % 8) END,
             CASE WHEN i % 2 = 0 THEN 0 ELSE 3 END
        FROM generate_series(1, 600000) g(i)
  `)
  await fixture.query('VACUUM ANALYZE messages')
  await refreshAdminStats()

  // Capture SQL from the actual scheduler, including its pre-migration fallback.
  const capture = async () => {
    const spy = mock.method(pg.Client.prototype, 'query')
    try {
      await refreshAdminStats()
      return spy.mock.calls.flatMap(({ arguments: args }) => {
        const sql = args[0]
        return typeof sql === 'string' &&
          /^\s*(INSERT INTO|DELETE FROM) public\.admin_workspace_(stats|daily_interactions)\b/.test(
            sql,
          )
          ? [{ sql, values: Array.isArray(args[1]) ? args[1] : [] }]
          : []
      })
    } finally {
      spy.mock.restore()
    }
  }
  const before = await capture()
  assert.equal(before.length, 1)
  await migrate('157_workspace_daily_interactions.sql')
  await refreshAdminStats()
  const after = await capture()
  assert.equal(after.length, 4)
  assert.deepEqual(
    (await fixture.query('SELECT * FROM admin_workspace_stats ORDER BY workspace_id')).rows,
    (
      await fixture.query(`
      SELECT workspace_id, (count(*) FILTER (WHERE role = 'user') +
        COALESCE(sum(event_count) FILTER (WHERE role = 'assistant'), 0))::integer AS interactions
        FROM messages GROUP BY workspace_id ORDER BY workspace_id
    `)
    ).rows,
  )
  await fixture.query('VACUUM ANALYZE admin_workspace_daily_interactions')
  const plans: unknown[] = []
  for (let round = 0; round < 3; round++) {
    for (const [label, queries] of [
      ['before', before],
      ['after', after],
    ] as const) {
      await fixture.query('BEGIN ISOLATION LEVEL REPEATABLE READ')
      const statements = []
      for (const { sql, values } of queries) {
        const { rows } = await fixture.query(
          `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`,
          values,
        )
        statements.push({ sql, explain: rows[0]['QUERY PLAN'][0] })
      }
      await fixture.query('ROLLBACK')
      plans.push({ round: round + 1, label, statements })
    }
  }
  console.log(
    JSON.stringify(
      {
        environment: (
          await fixture.query(`
      SELECT version(), current_setting('shared_buffers') AS shared_buffers,
             current_setting('TimeZone') AS timezone
    `)
        ).rows[0],
        fixture: (
          await fixture.query(`
      SELECT count(*)::int AS messages,
             count(*) FILTER (WHERE created_at >= current_date - 7)::int AS recent_messages,
             count(DISTINCT workspace_id)::int AS workspaces,
             count(DISTINCT workspace_id) FILTER (WHERE created_at >= current_date - 7)::int AS active_workspaces,
             pg_relation_size('messages') AS message_heap_bytes,
             pg_total_relation_size('admin_workspace_daily_interactions') AS daily_cache_bytes,
             (SELECT count(*)::int FROM admin_workspace_daily_interactions) AS daily_cache_rows
        FROM messages
    `)
        ).rows[0],
        plans,
      },
      null,
      2,
    ),
  )
} finally {
  await fixture.query('ROLLBACK')
  await pool.end()
  await fixture.end()
  await admin.query(`DROP DATABASE "${database}"`)
  await admin.end()
}
