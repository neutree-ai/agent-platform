import { spawn } from 'node:child_process'
import { serve } from '@hono/node-server'
import { DshBridge } from '../../../internal/dsh-adapter/index.js'
import { writePlatformPrompt } from '../../../internal/platform-prompt/src/index.js'
import {
  CP_URL,
  WORKSPACE_DIR,
  WORKSPACE_ID,
  buildLaunchSpec,
  loadConfig,
  loadCredentials,
  loadSkills,
} from './config.js'
import { app, injectWebSocket, setBridgeFactory, setRestartBridge } from './server.js'

writePlatformPrompt({
  agentKind: 'dsh',
  homeSubdir: '.dsh',
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

// cp can be briefly unreachable while the pod boots (cp restarting, a node
// coming back before its service routing is ready). Without the config the
// provider key never reaches the agent and every turn fails, so retry, and if
// cp stays away exit for a kubelet restart rather than serve a workspace that
// cannot run.
const CONFIG_MAX_RETRIES = 5
const CONFIG_RETRY_DELAY_MS = 3000
if (CP_URL && WORKSPACE_ID) {
  let loaded = false
  for (let attempt = 1; attempt <= CONFIG_MAX_RETRIES && !loaded; attempt++) {
    try {
      loaded = await loadConfig()
    } catch (e) {
      console.error('[agent] Failed to fetch config from CP:', e)
    }
    if (!loaded && attempt < CONFIG_MAX_RETRIES) {
      console.warn(
        `[agent] Config load attempt ${attempt}/${CONFIG_MAX_RETRIES} failed, retrying in ${CONFIG_RETRY_DELAY_MS}ms...`,
      )
      await new Promise((r) => setTimeout(r, CONFIG_RETRY_DELAY_MS))
    }
  }
  if (!loaded) {
    console.error(
      `[agent] BOOT_FAILED workspace=${WORKSPACE_ID} config load failed after ${CONFIG_MAX_RETRIES} attempts — exiting for kubelet restart`,
    )
    process.exit(1)
  }
  console.log('[agent] Config loaded from CP')
} else {
  await loadConfig()
}

try {
  const { ok, failed } = await loadSkills()
  if (ok) {
    console.log('[agent] Skills loaded from CP')
  } else if (failed.length > 0) {
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

// ── dsh bridge factory (1 bridge : 1 session : 1 runtime process) ──
//
// The runtime is spawned on the session's first prompt, not here: its
// composition carries the session's MCP servers, whose per-session token only
// arrives after this factory returns. `buildLaunchSpec` writes that
// composition and hands back the command, so a config reload or a new token
// takes effect on the next spawn without extra plumbing.
setBridgeFactory(async (sessionId: string) => {
  const bridge = new DshBridge({
    cwd: WORKSPACE_DIR,
    sessionId,
    resolveLaunch: async (id) => buildLaunchSpec(id),
  })
  await bridge.start()
  return bridge
})
console.log('[agent] dsh bridge factory ready')

// Config reload needs no work here: every bridge resolves its launch spec —
// composition file included — when it spawns, and bridges already spawned keep
// the runtime they have until they are naturally replaced.
setRestartBridge(async () => {})

// ── Start HTTP server ──

const port = Number.parseInt(process.env.PORT || '3001')
const server = serve({ fetch: app.fetch, port })
injectWebSocket(server)
console.log(`Agent server running on http://localhost:${port}`)

// ── Start ttyd (web terminal) ──

function startTtyd() {
  const child = spawn(
    'ttyd',
    ['-W', '-a', '-p', '7681', 'tmux', '-f', '/etc/tmux.conf', 'new-session', '-A', '-s'],
    { stdio: 'inherit', cwd: WORKSPACE_DIR },
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

const AFS_MOUNT_BASE = '/mnt/afs'
function startAfsDufs() {
  startDufs('afs', AFS_MOUNT_BASE, '8001', startAfsDufs)
}
startAfsDufs()
