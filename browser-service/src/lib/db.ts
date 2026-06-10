import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'

export const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/postgres',
})

const MIGRATIONS_TABLE = 'browser.schema_migrations'

export async function initDb() {
  await pool.query('CREATE SCHEMA IF NOT EXISTS browser')
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  const { rows } = await pool.query(`SELECT id FROM ${MIGRATIONS_TABLE} ORDER BY id`)
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
      await client.query(sql)
      await client.query(`INSERT INTO ${MIGRATIONS_TABLE} (id) VALUES ($1)`, [id])
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
