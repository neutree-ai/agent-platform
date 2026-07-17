import { upsertMcpCatalogEntry } from '../src/services/db/mcp-catalog'
/**
 * Seed the core MCP catalog entries needed for self-hosted deployment.
 * Downstream distributions can layer additional entries on top by calling
 * `upsertMcpCatalogEntry` from their own seed script.
 */
import { initDb, pool } from '../src/services/db/pool'

// The platform MCP server is control-plane's own /mcp endpoint. Derive its host
// from CP_SERVICE_URL (same env the deployment injects, prefix-aware) so the
// catalog URL resolves on installs where APP_PREFIX != "nap" (Service is
// `<prefix>-cp`, not `nap-cp`). Falls back to the default-prefix host.
const CP_SERVICE_URL = process.env.CP_SERVICE_URL || 'http://nap-cp:3000'

const SEED: Record<string, Parameters<typeof upsertMcpCatalogEntry>[1]> = {
  'tos-platform': {
    label: 'Platform',
    description: 'Memory read/write, cross-workspace agent calls',
    url: `${CP_SERVICE_URL}/mcp`,
    saas_url: null,
    group: 'Core',
    ui_panel: null,
    required: true,
    params: [],
    hooks: {},
  },
}

async function main() {
  await initDb()
  for (const [id, entry] of Object.entries(SEED)) {
    await upsertMcpCatalogEntry(id, entry)
    console.log(`  ✓ ${id}`)
  }
  console.log(`\nSeeded ${Object.keys(SEED).length} MCP catalog entries.`)
  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
