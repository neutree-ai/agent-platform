import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { dbQueryDuration } from '../../lib/metrics'

const _pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://tos:tos@localhost:5432/tos',
  max: 35,
})

// Wrap pool.query to observe DB query duration
const origQuery = _pool.query.bind(_pool)
_pool.query = ((...args: any[]) => {
  const start = Date.now()
  const result = (origQuery as any)(...args)
  if (result && typeof result.then === 'function') {
    result.then(
      () => dbQueryDuration.observe((Date.now() - start) / 1000),
      () => dbQueryDuration.observe((Date.now() - start) / 1000),
    )
  }
  return result
}) as typeof _pool.query

export const pool = _pool

// Run SQL migrations from control-plane/migrations/
export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  const { rows } = await pool.query('SELECT id FROM public.schema_migrations ORDER BY id')
  const applied = new Set(rows.map((r: { id: string }) => r.id))

  const migrationsDir = join(process.cwd(), 'migrations')
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  let newCount = 0
  for (const file of files) {
    const id = file.replace('.sql', '')
    if (applied.has(id)) continue

    const sql = readFileSync(join(migrationsDir, file), 'utf-8')
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      // Inject environment-derived session vars for migrations that need them.
      // is_local=true keeps the setting transaction-scoped (auto-reset on COMMIT).
      const credKey = process.env.CREDENTIAL_ENCRYPTION_KEY
      if (credKey) {
        await client.query('SELECT set_config($1, $2, true)', [
          'app.credential_encryption_key',
          credKey,
        ])
      }
      await client.query(sql)
      // A squashed pg_dump baseline sets search_path to '' (session-scoped:
      // set_config(..., false)), which persists past the migration body. Reset
      // it so the bookkeeping INSERT below resolves schema_migrations, and so the
      // empty search_path doesn't leak back onto the pooled connection and break
      // later unqualified app queries.
      await client.query('RESET search_path')
      await client.query('INSERT INTO public.schema_migrations (id) VALUES ($1)', [id])
      await client.query('COMMIT')
      console.log(`[db] migration applied: ${file}`)
      newCount++
    } catch (e) {
      await client.query('ROLLBACK')
      console.error(`[db] migration failed: ${file}`, e)
      throw e
    } finally {
      client.release()
    }
  }
  console.log(`[db] migrations: ${applied.size} existing, ${newCount} new, ${files.length} total`)
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 10)
}
