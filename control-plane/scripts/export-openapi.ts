// Write the control plane's OpenAPI document to a file, straight from the route
// definitions — no database, no running server. The document is byte-for-byte
// what /api/docs/openapi.json serves.
//
//   npx tsx scripts/export-openapi.ts <out.json>

import { writeFile } from 'node:fs/promises'
import { app, openApiInfo } from '../src/app'

const out = process.argv[2]
if (!out) {
  console.error('usage: export-openapi.ts <out.json>')
  process.exit(1)
}

await writeFile(out, JSON.stringify(app.getOpenAPI31Document(openApiInfo)))
console.log(`OpenAPI document written to ${out}`)
// Route modules hold timers and pools that would keep the process alive.
process.exit(0)
