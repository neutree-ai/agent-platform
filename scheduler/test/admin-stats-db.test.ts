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
      if (name < '151_') await migrate(name)
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
      await migrate('151_incremental_admin_stats.sql')
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
      'daily-cache migration preserves reads with an existing token watermark',
      async () => {
        const before = await snapshot()
        for (const name of (await readdir(migrations))
          .filter((name) => name.endsWith('.sql'))
          .sort()) {
          if (name >= '152_') await migrate(name)
        }
        assert.deepEqual(await snapshot(), before)
        assert.equal(
          (await fixture.query('SELECT workspace_daily_initialized FROM admin_stats_watermark'))
            .rows[0].workspace_daily_initialized,
          false,
        )
        // The previous scheduler's watermark upsert leaves the new initialization flag alone.
        await fixture.query(`
        INSERT INTO admin_stats_watermark (id, last_usage_id) VALUES (1, 0)
        ON CONFLICT (id) DO UPDATE SET last_usage_id = admin_stats_watermark.last_usage_id
      `)
        assert.deepEqual(await snapshot(), before)
      },
    )
    const dailySnapshot = async () =>
      normalized((await fixture.query('SELECT * FROM admin_workspace_daily_interactions')).rows)
    await t.test(
      'daily-cache initialization rolls back and retries independently of tokens',
      async () => {
        const before = await snapshot()
        await fixture.query(`
        ALTER TABLE admin_workspace_daily_interactions
          ADD CONSTRAINT reject_initialization CHECK (interactions < 0) NOT VALID
      `)
        await assert.rejects(refreshAdminStats(), { code: '23514' })
        assert.deepEqual(await dailySnapshot(), [])
        assert.deepEqual(await snapshot(), before)
        assert.equal(
          (await fixture.query('SELECT workspace_daily_initialized FROM admin_stats_watermark'))
            .rows[0].workspace_daily_initialized,
          false,
        )
        await fixture.query(
          'ALTER TABLE admin_workspace_daily_interactions DROP CONSTRAINT reject_initialization',
        )
        await Promise.all([refreshAdminStats(), refreshAdminStats()])
        await assertMatchesFull()
        assert.equal(
          (await fixture.query('SELECT workspace_daily_initialized FROM admin_stats_watermark'))
            .rows[0].workspace_daily_initialized,
          true,
        )
        assert.deepEqual(
          (
            await fixture.query(
              'SELECT workspace_id, interactions FROM admin_workspace_daily_interactions WHERE day IS NULL',
            )
          ).rows,
          [{ workspace_id: 'w2', interactions: '1' }],
        )
      },
    )
    await t.test(
      'increments, historical token arrivals, null timestamps and retries match full totals',
      async () => {
        const oldDay = (
          await fixture.query(
            'SELECT xmin::text FROM admin_daily_stats WHERE date = current_date - 30',
          )
        ).rows[0].xmin
        const oldWorkspaceDay = (
          await fixture.query(
            'SELECT xmin::text FROM admin_workspace_daily_interactions WHERE day = current_date - 30',
          )
        ).rows[0].xmin
        await fixture.query(`
      INSERT INTO messages (id, workspace_id, role, created_at)
        VALUES ('new-user', 'w1', 'user', current_date + interval '1 hour');
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
        assert.equal(
          (
            await fixture.query(
              'SELECT xmin::text FROM admin_workspace_daily_interactions WHERE day = current_date - 30',
            )
          ).rows[0].xmin,
          oldWorkspaceDay,
        )
        const beforeRetry = await snapshot()
        const dailyBeforeRetry = await dailySnapshot()
        await refreshAdminStats()
        assert.deepEqual(await snapshot(), beforeRetry)
        assert.deepEqual(await dailySnapshot(), dailyBeforeRetry)
      },
    )
    await t.test(
      'recent deletions remove empty days and workspaces but keep zero-interaction groups',
      async () => {
        await fixture.query(`
        INSERT INTO workspaces (id, user_id, name, created_at)
          VALUES ('deleted', 'u1', 'Deleted', current_date),
                 ('zero', 'u1', 'Zero', current_date),
                 ('null-only', 'u1', 'Null only', current_date);
        INSERT INTO messages (id, workspace_id, role, created_at)
          VALUES ('delete-boundary', 'deleted', 'user', current_date - 7),
                 ('delete-today', 'deleted', 'user', current_date),
                 ('zero-system', 'zero', 'system', current_date),
                 ('null-only-user', 'null-only', 'user', NULL);
      `)
        // NULL dates are initialized/repaired by the full rebuild.
        await refreshAdminStats(true)
        await assertMatchesFull()
        assert.deepEqual(
          (
            await fixture.query(
              "SELECT interactions FROM admin_workspace_stats WHERE workspace_id = 'zero'",
            )
          ).rows,
          [{ interactions: 0 }],
        )
        await fixture.query("DELETE FROM messages WHERE id = 'delete-boundary'")
        await refreshAdminStats()
        await assertMatchesFull()
        assert.equal(
          (
            await fixture.query(
              "SELECT * FROM admin_workspace_daily_interactions WHERE workspace_id = 'deleted' AND day = current_date - 7",
            )
          ).rowCount,
          0,
        )
        await fixture.query("DELETE FROM messages WHERE id = 'delete-today'")
        await refreshAdminStats()
        await assertMatchesFull()
        assert.equal(
          (
            await fixture.query(
              "SELECT * FROM admin_workspace_stats WHERE workspace_id = 'deleted'",
            )
          ).rowCount,
          0,
        )
        assert.deepEqual(
          (
            await fixture.query(
              "SELECT interactions FROM admin_workspace_stats WHERE workspace_id = 'null-only'",
            )
          ).rows,
          [{ interactions: 1 }],
        )
      },
    )
    await t.test(
      'the window includes midnight seven days ago and excludes the instant before it',
      async () => {
        await fixture.query(`
        INSERT INTO messages (id, workspace_id, role, created_at, event_count)
          VALUES ('edge-inside', 'w2', 'assistant', current_date - 7, 1),
                 ('edge-outside', 'w2', 'assistant', current_date - 7 - interval '1 microsecond', 1)
      `)
        await refreshAdminStats(true)
        await fixture.query(
          "UPDATE messages SET event_count = 2 WHERE id IN ('edge-inside', 'edge-outside')",
        )
        await refreshAdminStats()
        const expected = await fixture.query(`
        SELECT workspace_id, (count(*) FILTER (WHERE role = 'user') +
          COALESCE(sum(CASE WHEN id = 'edge-outside' THEN 1 ELSE event_count END)
                   FILTER (WHERE role = 'assistant'), 0))::integer AS interactions
          FROM messages GROUP BY workspace_id
      `)
        assert.deepEqual(
          normalized((await fixture.query('SELECT * FROM admin_workspace_stats')).rows),
          normalized(expected.rows),
        )
        await refreshAdminStats(true)
        await assertMatchesFull()
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
        const beforeHistoryChange = (await snapshot()).get('admin_workspace_stats')
        await fixture.query(`
          UPDATE messages SET event_count = event_count + 1 WHERE id = 'outside';
          DELETE FROM messages WHERE session_id = 's1' OR workspace_id = 'null-only';
        `)
        await fixture.query("DELETE FROM sessions WHERE id = 's1'")
        await refreshAdminStats()
        assert.deepEqual((await snapshot()).get('admin_workspace_stats'), beforeHistoryChange)
        await refreshAdminStats(true)
        await assertMatchesFull()
        assert.equal(
          (
            await fixture.query(
              "SELECT * FROM admin_workspace_stats WHERE workspace_id = 'null-only'",
            )
          ).rowCount,
          0,
        )
      },
    )
    await t.test('failed updates roll back snapshots and watermark together', async () => {
      const before = await snapshot()
      const dailyBefore = await dailySnapshot()
      const watermark = (await fixture.query('SELECT * FROM admin_stats_watermark')).rows
      await fixture.query(`
      ALTER TABLE admin_token_daily_stats ADD CONSTRAINT reject_refresh CHECK (input_tokens < 0) NOT VALID;
      INSERT INTO workspace_usage_events (workspace_id, user_id, source, model, input_tokens, ts, dedup_key, created_at)
        VALUES ('w2', 'u2', 'test', 'test', 47, current_date, 'rollback', now() - interval '2 minutes');
    `)
      await assert.rejects(refreshAdminStats(), { code: '23514' })
      assert.deepEqual(await snapshot(), before)
      assert.deepEqual(await dailySnapshot(), dailyBefore)
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
      assert.deepEqual(await dailySnapshot(), [])
      await fixture.query('UPDATE admin_stats_watermark SET workspace_daily_initialized = false')
      await refreshAdminStats()
      assert.equal(
        (await fixture.query('SELECT workspace_daily_initialized FROM admin_stats_watermark'))
          .rows[0].workspace_daily_initialized,
        true,
      )
      // An initialized empty cache must not trigger another historical scan on every tick.
      await fixture.query(`
        INSERT INTO workspaces (id, user_id, name, created_at)
          VALUES ('after-empty', 'u1', 'After empty', current_date - 30);
        INSERT INTO messages (id, workspace_id, role, created_at)
          VALUES ('backfilled', 'after-empty', 'user', current_date - 30)
      `)
      await refreshAdminStats()
      assert.deepEqual(await dailySnapshot(), [])
      await refreshAdminStats(true)
      await assertMatchesFull()
    })
    await t.test(
      'missing token state also rebuilds an already-initialized daily cache',
      async () => {
        await fixture.query(`
        DELETE FROM admin_stats_watermark;
        UPDATE messages SET event_count = 3, role = 'assistant' WHERE id = 'backfilled';
      `)
        await refreshAdminStats()
        await assertMatchesFull()
        assert.equal(
          (await fixture.query('SELECT workspace_daily_initialized FROM admin_stats_watermark'))
            .rows[0].workspace_daily_initialized,
          true,
        )
      },
    )
  },
)
