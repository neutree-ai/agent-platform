import { spawn } from 'node:child_process'
import { serve } from '@hono/node-server'
import { AcpBridge } from '../../../internal/acp-adapter/acp-bridge.js'
import { writePlatformPrompt } from '../../../internal/platform-prompt/src/index.js'
import {
  WORKSPACE_DIR,
  WORKSPACE_ID,
  applyProviderEnv,
  loadConfig,
  loadCredentials,
  loadRuntimeConfig,
  loadSkills,
} from './config.js'
import {
  app,
  injectWebSocket,
  setBridgeFactory,
  setRestartBridge,
  trackExtNotification,
} from './server.js'
import { sessionIdMap } from './session-id-map.js'

writePlatformPrompt({
  agentKind: 'goose',
  homeSubdir: '.config/goose',
  filename: 'AGENTS.md',
  workspaceId: WORKSPACE_ID,
})

process.on('uncaughtException', (err) => {
  console.error('[fatal] Uncaught exception (process kept alive):', err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[fatal] Unhandled rejection (process kept alive):', reason)
})

// ── Load config from CP ──

try {
  if (await loadConfig()) {
    console.log('[agent] Config loaded from CP')
  }
} catch (e) {
  console.error('[agent] Failed to fetch config from CP:', e)
}

try {
  const { ok, failed } = await loadSkills()
  if (ok) {
    console.log('[agent] Skills loaded from CP')
  } else if (failed.length > 0) {
    // Boot-time download retries exhausted for at least one skill. Existing
    // disk state was preserved by the atomic swap, but we'd rather restart and
    // try again than silently serve a degraded workspace for hours (the
    // 0zh57cmu incident: 18h of empty skills dir until the user noticed).
    console.error(
      `[skills] BOOT_FAILED workspace=${process.env.WORKSPACE_ID} failed_names=${failed.join(',')} — exiting for kubelet restart`,
    )
    process.exit(1)
  }
} catch (e) {
  console.error(
    `[skills] BOOT_FAILED workspace=${process.env.WORKSPACE_ID} reason=${(e as Error).message} — exiting for kubelet restart`,
  )
  process.exit(1)
}

try {
  if (await loadCredentials()) {
    console.log('[agent] Credentials loaded from CP')
  }
} catch (e) {
  console.error('[agent] Failed to load credentials from CP:', e)
}

// ── Apply provider env vars ──

const rc = loadRuntimeConfig()
if (rc) {
  applyProviderEnv(rc)
  console.log(`[agent] Provider env applied: ${rc.provider_type} model=${rc.model}`)
}

// ── ACP bridge factory (1 bridge per session, matching the codex layout;
//    goose supports multiple sessions per process, but per-session bridges
//    keep the eviction/rebuild semantics of acp-server unchanged) ──

// --with-builtin developer: when session/new carries mcpServers (always, for
// tos-platform), goose REPLACES the config-file extension set with that list —
// only CLI-pinned builtins survive (initial_session_extensions in goose's ACP
// server). Without this flag the agent has no shell/edit tools.
//
// sessionIdCodec: goose session ids are `YYYYMMDD_<counter>` from its local
// SQLite — per-instance only, counter resets on store wipe, and cp's
// sessions.id is a global primary key. Mint platform UUIDs with a durable
// alias map (see session-id-map.ts); legacy prefixed/raw ids still decode.
//
// customNotifications + onExtNotification: unlock goose's private
// `_goose/unstable/session/update` stream — its `accumulatedInputTokens` /
// `accumulatedOutputTokens` counters are the only accurate billing source
// (PromptResponse.usage reports just the turn's LAST request, undercounting
// tool-loop turns ~2×+). server.ts tracks the counters for recordUsage.
const BRIDGE_OPTS = {
  program: 'goose',
  args: ['acp', '--with-builtin', 'developer'],
  cwd: WORKSPACE_DIR,
  sessionIdCodec: sessionIdMap(),
  clientCapabilitiesMeta: { goose: { customNotifications: true } },
  onExtNotification: trackExtNotification,
}

setBridgeFactory(async () => {
  const b = new AcpBridge(BRIDGE_OPTS)
  await b.start()
  return b
})
console.log('[agent] ACP bridge factory ready')

// On config/credentials reload: refresh env so newly spawned bridges pick up
// the new provider config. Existing bridges keep their old env until they
// naturally die — killing them mid-turn would abort in-flight sessions.
setRestartBridge(async () => {
  const rc = loadRuntimeConfig()
  if (rc) applyProviderEnv(rc)
})

// ── Start HTTP server ──

const port = Number.parseInt(process.env.PORT || '3001')
const server = serve({ fetch: app.fetch, port })
injectWebSocket(server)
console.log(`Agent server running on http://localhost:${port}`)

// ── Start ttyd (web terminal) ──

function startTtyd() {
  const child = spawn(
    'ttyd',
    // -a accepts ?arg=<name> from the connection URL and appends to the
    // spawned command, so each terminal panel slot can attach to its own
    // tmux session. Trailing -s without a value lets the URL arg supply the
    // session name; the agent server validates+defaults before forwarding.
    ['-W', '-a', '-p', '7681', 'tmux', '-f', '/etc/tmux.conf', 'new-session', '-A', '-s'],
    {
      stdio: 'inherit',
      cwd: WORKSPACE_DIR,
    },
  )
  child.on('error', (err) => {
    console.error('[agent] Failed to start ttyd:', err.message)
  })
  child.on('exit', (code) => {
    console.warn(`[agent] ttyd exited with code ${code}, restarting in 2s...`)
    setTimeout(startTtyd, 2000)
  })
}
startTtyd()

// ── Start dufs (file browser) ──

function startDufs(label: string, servePath: string, port: string, restart: () => void) {
  const child = spawn('dufs', [servePath, '-A', '--allow-symlink', '--port', port], {
    stdio: 'inherit',
  })
  child.on('error', (err) => {
    console.error(`[agent] Failed to start dufs (${label}):`, err.message)
  })
  child.on('exit', (code) => {
    console.warn(`[agent] dufs (${label}) exited with code ${code}, restarting in 2s...`)
    setTimeout(restart, 2000)
  })
}

function startWorkspaceDufs() {
  startDufs('workspace', WORKSPACE_DIR, '8000', startWorkspaceDufs)
}
startWorkspaceDufs()

// Mount-point for AgentFS shared folders (see sidecar config).
const AFS_MOUNT_BASE = '/mnt/afs'
function startAfsDufs() {
  startDufs('afs', AFS_MOUNT_BASE, '8001', startAfsDufs)
}
startAfsDufs()
