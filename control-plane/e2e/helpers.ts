import { type ChildProcess, spawn } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { NapClient } from '../../internal/client/src'
import { hashToken } from '../src/lib/service-token'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_DB = 'tos_cp_test'
// Base Postgres URL (without database name). Override E2E_PG_BASE_URL to point
// at your test cluster; defaults to a local dev Postgres.
const PG_BASE_URL = process.env.E2E_PG_BASE_URL ?? 'postgresql://tos:tos@localhost:5432'
const ADMIN_PG = `${PG_BASE_URL}/postgres`
const TEST_DB_URL = `${PG_BASE_URL}/${TEST_DB}`

export const TEST_SERVICE_TOKEN = 'tos_e2e_test_token_0000000000000000000000000000000000000000'
export const TEST_USER_ID = 'e2e-test-user'

const CP_PORT = 13000
const CP_BASE_URL = `http://localhost:${CP_PORT}`

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

const pool = new pg.Pool({ connectionString: TEST_DB_URL })

/** Create the test database if it doesn't exist. */
export async function createTestDatabase() {
  const adminPool = new pg.Pool({ connectionString: ADMIN_PG })
  try {
    const { rows } = await adminPool.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      TEST_DB,
    ])
    if (rows.length === 0) {
      await adminPool.query(`CREATE DATABASE ${TEST_DB}`)
    }
  } finally {
    await adminPool.end()
  }
}

/** Drop the test database (terminate connections first). */
export async function dropTestDatabase() {
  const adminPool = new pg.Pool({ connectionString: ADMIN_PG })
  try {
    await adminPool.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
      [TEST_DB],
    )
    await adminPool.query(`DROP DATABASE IF EXISTS ${TEST_DB}`)
  } finally {
    await adminPool.end()
  }
}

/** Run all SQL migrations from control-plane/migrations/ */
export async function runMigrations() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  const { rows } = await pool.query('SELECT id FROM public.schema_migrations ORDER BY id')
  const applied = new Set(rows.map((r: { id: string }) => r.id))

  const migrationsDir = join(__dirname, '../migrations')
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  for (const file of files) {
    const id = file.replace('.sql', '')
    if (applied.has(id)) continue

    const sql = readFileSync(join(migrationsDir, file), 'utf-8')
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(sql)
      // See services/db/pool.ts: reset the search_path the pg_dump baseline
      // clears, so the bookkeeping INSERT resolves and the pooled connection
      // returns clean.
      await client.query('RESET search_path')
      await client.query('INSERT INTO public.schema_migrations (id) VALUES ($1)', [id])
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  }
}

/** Truncate all user-created tables (NOT schema_migrations). */
export async function cleanTables() {
  await pool.query(`
    TRUNCATE
      service_tokens,
      workspace_tag_assignments,
      workspace_tags,
      template_versions,
      templates,
      prompt_versions,
      prompts,
      shares,
      model_providers,
      user_credentials,
      sessions,
      skills,
      workspace_skills,
      workspace_config,
      messages,
      workspaces,
      users
    CASCADE
  `)
}

/** Close the pool. */
export async function closePool() {
  await pool.end()
}

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

/** Insert a test user and service token into the DB. */
export async function seedTestUser() {
  // Insert user
  await pool.query(
    `INSERT INTO users (id, username, display_name, email)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO NOTHING`,
    [TEST_USER_ID, 'e2e-test', 'E2E Test User', 'e2e@test.local'],
  )

  // Insert service token
  const tokenHash = hashToken(TEST_SERVICE_TOKEN)
  await pool.query(
    `INSERT INTO service_tokens (id, name, token_hash, created_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO NOTHING`,
    ['e2e-test-token', 'e2e-test', tokenHash, TEST_USER_ID],
  )

  // Insert test skills for template tests. p3: each skill needs a backing
  // source + initial version because skills.package is gone and the FK on
  // source_id is NOT NULL. We do this raw (bypassing scs) since the e2e
  // harness runs without scs.
  for (const name of ['gitlab-rest-api', 'slack-web-api']) {
    const existing = await pool.query('SELECT id FROM skills WHERE user_id = $1 AND name = $2', [
      TEST_USER_ID,
      name,
    ])
    if (existing.rowCount && existing.rowCount > 0) continue
    const { rows: sourceRows } = await pool.query(
      `INSERT INTO skill_sources (user_id, kind) VALUES ($1, 'native') RETURNING id`,
      [TEST_USER_ID],
    )
    const sourceId = sourceRows[0].id as string
    const { rows: skillRows } = await pool.query(
      `INSERT INTO skills (source_id, user_id, name, description, visibility, is_public)
       VALUES ($1, $2, $3, $4, 'public', true) RETURNING id`,
      [sourceId, TEST_USER_ID, name, `${name} skill`],
    )
    const skillId = skillRows[0].id as string
    const { rows: versionRows } = await pool.query(
      `INSERT INTO skill_versions (skill_id, source_id, package, note, published_by)
       VALUES ($1, $2, $3, 'e2e seed', $4) RETURNING id`,
      [skillId, sourceId, Buffer.from(''), TEST_USER_ID],
    )
    await pool.query('UPDATE skills SET active_version_id = $1 WHERE id = $2', [
      versionRows[0].id,
      skillId,
    ])
  }
}

// ---------------------------------------------------------------------------
// CP process management
// ---------------------------------------------------------------------------

/** Spawn the control-plane process with test env vars. */
export async function startCp(): Promise<ChildProcess> {
  const cpDir = join(__dirname, '..')

  const proc = spawn('node', ['--import', 'tsx', 'src/index.ts'], {
    cwd: cpDir,
    env: {
      ...process.env,
      DATABASE_URL: TEST_DB_URL,
      PORT: String(CP_PORT),
      JWT_SECRET: 'test-secret',
      KUBECONFIG: process.env.KUBECONFIG ?? '',
      K8S_NAMESPACE: process.env.K8S_NAMESPACE ?? 'default',
      CLUSTER_VIP: process.env.CLUSTER_VIP ?? '',
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || '',
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  })

  // Wait for the ready message
  await new Promise<void>((resolve, reject) => {
    let buffer = ''
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf-8')
      if (buffer.includes('Control plane starting on port')) {
        proc.stdout?.off('data', onData)
        resolve()
      }
    }
    proc.stdout?.on('data', onData)
    proc.once('exit', () => reject(new Error('CP process exited before becoming ready')))
  })

  // Keep draining stdout so the pipe buffer doesn't fill up
  proc.stdout?.on('data', () => {})

  // Poll until the server is actually accepting requests
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://localhost:${CP_PORT}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: '', password: '' }),
      })
      // Any response (even 400) means the server is up
      if (res.status !== 502) break
    } catch {
      // Connection refused — server not ready yet
    }
    await new Promise((r) => setTimeout(r, 100))
  }

  return proc
}

/** Kill the CP process. */
export async function stopCp(proc: ChildProcess) {
  proc.kill()
  if (proc.exitCode === null) {
    await new Promise<void>((resolve) => proc.once('exit', () => resolve()))
  }
}

// ---------------------------------------------------------------------------
// Client helper
// ---------------------------------------------------------------------------

/** Create a NapClient configured for the test CP instance. */
export function createClient(): NapClient {
  return new NapClient({
    baseUrl: CP_BASE_URL,
    serviceToken: TEST_SERVICE_TOKEN,
  })
}
