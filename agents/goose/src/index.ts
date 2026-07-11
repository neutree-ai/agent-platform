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
import { prepareSessionDir, sessionDirCodec, sweepOrphanSessionDirs } from './session-store.js'

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

// ── ACP bridge factory (1 bridge : 1 session : 1 data dir) ──

// --with-builtin developer: when session/new carries mcpServers (always, for
// tos-platform), goose REPLACES the config-file extension set with that list —
// only CLI-pinned builtins survive (initial_session_extensions in goose's ACP
// server). Without this flag the agent has no shell/edit tools.
//
// GOOSE_PATH_ROOT: every session runs against its own private goose store —
// the platform session id (acp-server's draft UUID for new sessions) names
// the dir, sessionDirCodec maps it to/from goose's per-dir native id, and
// config/.agents stay shared via symlinks. See session-store.ts for why
// (NFS SQLite contention + serverless multi-pod safety).
//
// customNotifications + onExtNotification: unlock goose's private
// `_goose/unstable/session/update` stream — its `accumulatedInputTokens` /
// `accumulatedOutputTokens` counters are the only accurate billing source
// (PromptResponse.usage reports just the turn's LAST request, undercounting
// tool-loop turns ~2×+). server.ts tracks the counters for recordUsage,
// keyed by the platform id: this bridge serves exactly one session, so the
// closure id is authoritative and the notification's native id can be
// ignored.
setBridgeFactory(async (sessionId: string) => {
  const dataDir = prepareSessionDir(sessionId)
  const b = new AcpBridge({
    program: 'goose',
    args: ['acp', '--with-builtin', 'developer'],
    cwd: WORKSPACE_DIR,
    env: { GOOSE_PATH_ROOT: dataDir },
    sessionIdCodec: sessionDirCodec(sessionId),
    clientCapabilitiesMeta: { goose: { customNotifications: true } },
    onExtNotification: (method, params) => trackExtNotification(sessionId, method, params),
  })
  await b.start()
  return b
})
sweepOrphanSessionDirs()
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
