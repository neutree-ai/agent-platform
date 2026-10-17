import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { test } from 'node:test'
import pg from 'pg'

const testUrl = process.env.TEST_DATABASE_URL

test(
  'stats migration and refresh agree with the original full recomputations',
  {
    skip:
      !testUrl &&
      'Set TEST_DATABASE_URL to a disposable PostgreSQL server with CREATE DATABASE permission',
  },
  async (t) => {
    const admin = new pg.Client({ connectionString: testUrl })
    await admin.connect()
    const database = `stats_test_${randomUUID().replaceAll('-', '')}`
    await admin.query(`CREATE DATABASE "${database}"`)
    const url = new URL(testUrl!)
    url.pathname = `/${database}`
    process.env.DATABASE_URL = url.toString()
    const { pool } = await import('../src/db')
    const { refreshAdminStats } = await import('../src/admin-stats-db')
    const fixture = new pg.Client({ connectionString: url.toString() })
    await fixture.connect()
    t.after(async () => {
      await pool.end()
      await fixture.end()
      await admin.query(`DROP DATABASE "${database}"`)
      await admin.end()
    })
    const migrations = new URL('../../control-plane/migrations/', import.meta.url)
    const migrate = async (name: string) => {
      await fixture.query('BEGIN')
      try {
        await fixture.query(await readFile(new URL(name, migrations), 'utf8'))
        await fixture.query('RESET search_path')
        await fixture.query('COMMIT')
      } catch (error) {
        await fixture.query('ROLLBACK')
        throw error
      }
    }
    for (const name of (await readdir(migrations)).filter((name) => name.endsWith('.sql')).sort()) {
      if (name < '149_') await migrate(name)
    }
    await fixture.query(`
    INSERT INTO users (id, username, display_name)
      VALUES ('u1', 'u1', 'First'), ('u2', 'u2', 'Second');
    INSERT INTO workspaces (id, user_id, name, created_at)
      VALUES ('w1', 'u1', 'First', current_date - 40), ('w2', 'u2', 'Second', current_date - 20);
    INSERT INTO sessions (id, workspace_id, created_at, last_active_at)
      VALUES ('s1', 'w1', current_date - 40, current_date - 2),
             ('s2', 'w1', current_date, current_date),
             ('s3', 'w2', current_date - 20, current_date - 6);
    INSERT INTO messages (id, workspace_id, session_id, role, created_at)
      VALUES ('old_user', 'w1', 's1', 'user', current_date - 30),
             ('old_assistant', 'w1', 's1', 'assistant', current_date - 30),
             ('today_user', 'w1', 's2', 'user', current_date),
             ('today_assistant', 'w1', 's2', 'assistant', current_date),
             ('boundary', 'w2', 's3', 'assistant', current_date - 7),
             ('outside', 'w2', 's3', 'assistant', current_date - 8),
             ('no_session', 'w1', NULL, 'user', current_date),
             ('system', 'w2', 's3', 'system', current_date),
             ('null_day', 'w2', 's3', 'user', NULL),
             ('future', 'w2', 's3', 'assistant', current_date + 1);
    INSERT INTO session_events (id, message_id, session_id, kind, payload)
      SELECT id || '-event', id, session_id, 'text', '{}'
        FROM messages WHERE role = 'assistant';
    INSERT INTO workspace_usage_events
      (workspace_id, user_id, source, model, input_tokens, output_tokens,
       cache_read_tokens, cache_creation_tokens, ts, dedup_key, created_at)
      VALUES ('w1', 'u1', 'test', 'test', 9007199254740993, 7, 3, 2, current_date - 30, 'historic', now() - interval '5 minutes'),
             ('w2', 'u2', 'test', 'test', 11, 5, 2, 1, current_date, 'today', now() - interval '5 minutes'),
             ('w2', 'u2', 'test', 'test', 13, 6, 4, 2, NULL, 'null-ts', now() - interval '5 minutes');
  `)
    const names = [
      'admin_workspace_stats',
      'admin_daily_stats',
      'user_daily_interactions',
      'admin_token_user_stats',
      'admin_token_workspace_stats',
      'admin_token_daily_stats',
    ]
    const definitions = new Map<string, string>()
    for (const name of names) {
      const { rows } = await fixture.query('SELECT pg_get_viewdef($1::regclass, true) AS sql', [
        name,
      ])
      definitions.set(name, rows[0].sql)
    }
    const normalized = (rows: object[]) => rows.map((row) => JSON.stringify(row)).sort()
    const snapshot = async () => {
      const result = new Map<string, string[]>()
      for (const name of names) {
        result.set(name, normalized((await fixture.query(`SELECT * FROM public.${name}`)).rows))
      }
      return result
    }
    const assertMatchesFull = async () => {
      for (const name of names) {
        assert.deepEqual(
          normalized((await fixture.query(`SELECT * FROM public.${name}`)).rows),
          normalized((await fixture.query(definitions.get(name)!)).rows),
          name,
        )
      }
    }

    await t.test(
      'scheduler-first refresh handles the old, initially unpopulated views',
      async () => {
        await refreshAdminStats()
        await assertMatchesFull()
      },
    )
    await t.test('migration preserves snapshots and supports an unpopulated view', async () => {
      const before = await snapshot()
      await fixture.query('REFRESH MATERIALIZED VIEW admin_token_daily_stats WITH NO DATA')
      before.set('admin_token_daily_stats', [])
      await migrate('149_incremental_admin_stats.sql')
      assert.deepEqual(await snapshot(), before)
      assert.equal(
        (await fixture.query('SELECT count(*)::int AS n FROM admin_stats_watermark')).rows[0].n,
        0,
      )
      // A legacy refresh fails, but readers can still access the preserved snapshots.
      await assert.rejects(
        fixture.query('REFRESH MATERIALIZED VIEW admin_daily_stats'),
        /not a materialized view/,
      )
      assert.deepEqual(await snapshot(), before)
    })
    await t.test('missing watermark triggers an immediate full rebuild', async () => {
      await refreshAdminStats()
      await assertMatchesFull()
      assert.equal(
        (await fixture.query('SELECT count(*)::int AS n FROM admin_stats_watermark')).rows[0].n,
        1,
      )
    })
    await t.test(
      'increments, historical token arrivals, null timestamps and retries match full totals',
      async () => {
        const oldDay = (
          await fixture.query(
            'SELECT xmin::text FROM admin_daily_stats WHERE date = current_date - 30',
          )
        ).rows[0].xmin
        await fixture.query(`
      INSERT INTO session_events (id, message_id, session_id, kind, payload)
        VALUES ('new-today', 'today_assistant', 's2', 'text', '{}'),
               ('new-boundary', 'boundary', 's3', 'text', '{}');
      INSERT INTO workspace_usage_events (workspace_id, user_id, source, model, input_tokens, ts, dedup_key, created_at)
        VALUES ('w1', 'u1', 'test', 'test', 23, current_date - 30, 'late-transcript', now() - interval '2 minutes'),
               ('w2', 'u2', 'test', 'test', 17, NULL, 'late-null', now() - interval '2 minutes'),
               ('w1', 'u1', 'test', 'test', 999, current_date, 'historic', now() - interval '2 minutes')
        ON CONFLICT (dedup_key) DO NOTHING;
    `)
        await refreshAdminStats()
        await assertMatchesFull()
        assert.equal(
          (
            await fixture.query(
              'SELECT xmin::text FROM admin_daily_stats WHERE date = current_date - 30',
            )
          ).rows[0].xmin,
          oldDay,
        )
        const beforeRetry = await snapshot()
        await refreshAdminStats()
        assert.deepEqual(await snapshot(), beforeRetry)
      },
    )
    await t.test(
      'safety lag also holds back higher IDs behind a recently committed row',
      async () => {
        const before = (await snapshot()).get('admin_token_user_stats')
        await fixture.query(`
      INSERT INTO workspace_usage_events (workspace_id, user_id, source, model, input_tokens, ts, dedup_key, created_at)
        VALUES ('w1', 'u1', 'test', 'test', 31, current_date, 'young', now()),
               ('w1', 'u1', 'test', 'test', 37, current_date, 'higher-id', now() - interval '2 minutes');
    `)
        await refreshAdminStats()
        assert.deepEqual((await snapshot()).get('admin_token_user_stats'), before)
        await fixture.query(
          "UPDATE workspace_usage_events SET created_at = now() - interval '2 minutes' WHERE dedup_key = 'young'",
        )
        await refreshAdminStats()
        await assertMatchesFull()
      },
    )
    await t.test(
      'nightly rebuild repairs commits arriving behind the watermark and old deletions',
      async () => {
        const delayed = new pg.Client({ connectionString: url.toString() })
        await delayed.connect()
        try {
          await delayed.query('BEGIN')
          await delayed.query(`
        INSERT INTO workspace_usage_events (workspace_id, user_id, source, model, input_tokens, ts, dedup_key, created_at)
          VALUES ('w1', 'u1', 'test', 'test', 41, current_date, 'delayed-commit', now() - interval '10 minutes')
      `)
          await fixture.query(`
        INSERT INTO workspace_usage_events (workspace_id, user_id, source, model, input_tokens, ts, dedup_key, created_at)
          VALUES ('w1', 'u1', 'test', 'test', 43, current_date, 'visible-higher-id', now() - interval '2 minutes')
      `)
          await refreshAdminStats()
          const before = (await snapshot()).get('admin_token_user_stats')
          await delayed.query('COMMIT')
          await refreshAdminStats()
          assert.deepEqual((await snapshot()).get('admin_token_user_stats'), before)
        } finally {
          await delayed.end()
        }
        await fixture.query("DELETE FROM messages WHERE session_id = 's1'")
        await fixture.query("DELETE FROM sessions WHERE id = 's1'")
        await refreshAdminStats(true)
        await assertMatchesFull()
      },
    )
    await t.test('failed updates roll back snapshots and watermark together', async () => {
      const before = await snapshot()
      const watermark = (await fixture.query('SELECT * FROM admin_stats_watermark')).rows
      await fixture.query(`
      ALTER TABLE admin_token_daily_stats ADD CONSTRAINT reject_refresh CHECK (input_tokens < 0) NOT VALID;
      INSERT INTO workspace_usage_events (workspace_id, user_id, source, model, input_tokens, ts, dedup_key, created_at)
        VALUES ('w2', 'u2', 'test', 'test', 47, current_date, 'rollback', now() - interval '2 minutes');
    `)
      await assert.rejects(refreshAdminStats(), { code: '23514' })
      assert.deepEqual(await snapshot(), before)
      assert.deepEqual((await fixture.query('SELECT * FROM admin_stats_watermark')).rows, watermark)
      await fixture.query('ALTER TABLE admin_token_daily_stats DROP CONSTRAINT reject_refresh')
      await refreshAdminStats()
      await assertMatchesFull()
    })
    await t.test('simultaneous refresh and rebuild serialize without double counting', async () => {
      await Promise.all([refreshAdminStats(), refreshAdminStats(true)])
      await assertMatchesFull()
    })
    await t.test('empty data produces the same empty snapshots as full recomputation', async () => {
      await fixture.query(
        'TRUNCATE workspaces, sessions, messages, session_events, workspace_usage_events CASCADE',
      )
      await refreshAdminStats(true)
      await assertMatchesFull()
    })
  },
)
