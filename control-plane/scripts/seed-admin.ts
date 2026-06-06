/**
 * Seed the first admin user for fresh deployments (no LDAP).
 *
 * Usage (in container):
 *   DATABASE_URL=postgresql://... node dist/seed-admin.js \
 *     --username admin --password <password> [--display-name Admin]
 *
 * Idempotent: if the username already exists, skips without changes.
 */
import { hash as argon2Hash } from '@node-rs/argon2'
import { initDb, pool } from '../src/services/db/pool'
import { createUser, getUserByUsername } from '../src/services/db/users'

function parseArgs() {
  const args = process.argv.slice(2)
  const get = (flag: string): string | undefined => {
    const idx = args.indexOf(flag)
    return idx >= 0 ? args[idx + 1] : undefined
  }
  const username = get('--username')
  const password = get('--password')
  const displayName = get('--display-name') || username || 'Admin'

  if (!username || !password) {
    console.error(
      'Usage: node dist/seed-admin.js --username <user> --password <pass> [--display-name <name>]',
    )
    process.exit(1)
  }
  if (password.length < 6) {
    console.error('Error: password must be at least 6 characters')
    process.exit(1)
  }
  return { username, password, displayName }
}

// Platform-invariant rows the app hard-requires, independent of any admin
// account: the internal `system` principal (referenced by role checks and as a
// resource owner) and the singleton system_settings row. Idempotent — existing
// deployments already have these (originally created by migrations), so this is
// a no-op there and seeds them on a fresh install.
async function seedCore() {
  await pool.query(
    `INSERT INTO users (id, username, display_name, role)
     VALUES ('system', '__system__', 'System', 'system')
     ON CONFLICT (id) DO NOTHING`,
  )
  await pool.query('INSERT INTO system_settings (id) VALUES (1) ON CONFLICT DO NOTHING')
}

async function main() {
  const { username, password, displayName } = parseArgs()

  // Run migrations first to ensure schema is up to date
  await initDb()
  // Seed platform-invariant rows the schema no longer carries (moved out of
  // migrations so the baseline stays pure schema).
  await seedCore()

  const existing = await getUserByUsername(username)

  if (existing) {
    console.log(`[seed-admin] User "${username}" already exists, skipping`)
  } else {
    const hash = await argon2Hash(password)
    await createUser(username, displayName, hash, undefined, 'admin')
    console.log(`[seed-admin] Created admin user "${username}"`)
  }

  await pool.end()
}

main().catch((err) => {
  console.error('[seed-admin] Fatal:', err)
  process.exit(1)
})
