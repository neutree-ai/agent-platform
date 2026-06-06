/**
 * Register the built-in OAuth clients that high-tier services log in with.
 *
 * sandbox-service and browser-service authenticate end users via NAP OAuth
 * (PKCE public clients — no client_secret). Their fixed client_ids
 * (`sandbox-service` / `browser-service`) must exist in `oauth_clients` or
 * `GET /api/oauth/authorize` returns 400 invalid_client. Cloud deployments
 * created these rows by hand in the Applications UI; self-host needs them
 * seeded automatically.
 *
 * Usage (in container):
 *   SANDBOX_OAUTH_REDIRECT_URI=http://host:30086/api/auth/callback \
 *   BROWSER_OAUTH_REDIRECT_URI=http://host:30085/api/auth/callback \
 *   DATABASE_URL=postgresql://... node dist/seed-oauth-clients.js
 *
 * A client is registered only when its *_OAUTH_REDIRECT_URI env is non-empty,
 * so disabled modules are skipped. Idempotent: re-running upserts the
 * redirect_uris (so changing a NodePort and re-installing self-corrects).
 */
import { initDb, pool } from '../src/services/db/pool'

type ClientSpec = {
  id: string
  name: string
  redirectEnv: string
}

const CLIENTS: ClientSpec[] = [
  {
    id: 'sandbox-service',
    name: 'Code Sandbox',
    redirectEnv: 'SANDBOX_OAUTH_REDIRECT_URI',
  },
  {
    id: 'browser-service',
    name: 'Remote Browser',
    redirectEnv: 'BROWSER_OAUTH_REDIRECT_URI',
  },
]

/** First admin user owns the seeded clients (oauth_clients.created_by FK). */
async function getOwnerId(): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    "SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1",
  )
  if (rows.length === 0) {
    throw new Error('no admin user found — run seed-admin before seed-oauth-clients')
  }
  return rows[0].id
}

async function main() {
  // Run migrations first to ensure the oauth_clients table exists.
  await initDb()

  const specs = CLIENTS.map((c) => ({
    ...c,
    redirectUri: (process.env[c.redirectEnv] || '').trim(),
  }))
  const enabled = specs.filter((s) => s.redirectUri)

  if (enabled.length === 0) {
    console.log('[seed-oauth-clients] no redirect URIs set — nothing to register')
    await pool.end()
    return
  }

  const ownerId = await getOwnerId()

  for (const spec of enabled) {
    // Public PKCE clients: secret_hash stays NULL. ON CONFLICT keeps a single
    // row per id and re-syncs redirect_uris when ports/hosts change.
    await pool.query(
      `INSERT INTO oauth_clients (id, name, secret_hash, redirect_uris, created_by)
       VALUES ($1, $2, NULL, $3, $4)
       ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name,
             redirect_uris = EXCLUDED.redirect_uris,
             updated_at = NOW()`,
      [spec.id, spec.name, [spec.redirectUri], ownerId],
    )
    console.log(`[seed-oauth-clients] registered "${spec.id}" → ${spec.redirectUri}`)
  }

  await pool.end()
}

main().catch((err) => {
  console.error('[seed-oauth-clients] Fatal:', err)
  process.exit(1)
})
