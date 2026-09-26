/**
 * The runtime process: boot one generated composition and serve it over stdio.
 *
 * dsh's own `dsh` CLI boots a named profile — its bundle layers under the
 * caller's patches — and pulls in every package any profile could name. The
 * platform writes the complete plugin tree itself (see `cordis.ts`), so it
 * boots that file directly through the same app-boot the CLI uses, and
 * installs only the plugins the tree names.
 *
 * Usage: `node launcher.js <cordis.yml>`, or `DSH_CORDIS_CONFIG=<cordis.yml>`.
 * Stdout carries JSON-RPC frames; nothing here writes to it.
 */

import { existsSync } from 'node:fs'
import { boot, installFailLoud, loadEnv, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'

const NAME = 'dsh-platform-runtime'

installFailLoud(NAME)
loadEnv(NAME)

const requested = process.env.DSH_CORDIS_CONFIG || process.argv[2]
const configPath = requested ? resolveConfigPath(requested, undefined) : undefined
if (configPath === undefined || !existsSync(configPath)) {
  process.stderr.write(`usage: ${NAME} <path/to/cordis.yml> (or set DSH_CORDIS_CONFIG)\n`)
  process.exit(1)
}

// Bare plugin names resolve from the config file's location, which sits under
// the agent's app directory and so reaches its node_modules.
const ctx = await boot(NAME, configPath, undefined, undefined, undefined)

let exiting = false
async function disposeAndExit(code: number): Promise<void> {
  if (exiting) return
  exiting = true
  try {
    await ctx.fiber.dispose()
  } finally {
    process.exit(code)
  }
}

process.stdin.on('end', () => {
  void disposeAndExit(0)
})
process.on('SIGTERM', () => {
  void disposeAndExit(0)
})
process.on('SIGINT', () => {
  void disposeAndExit(130)
})
