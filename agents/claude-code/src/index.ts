import { spawn } from 'node:child_process'
import { serve } from '@hono/node-server'
import { writePlatformPrompt } from '../../../internal/platform-prompt/src/index.js'
import { CP_URL, WORKSPACE_ID, loadConfig, loadCredentials, loadSkills } from './config.js'
import { WORKSPACE_DIR } from './config.js'

writePlatformPrompt({
  agentKind: 'claude-code',
  homeSubdir: '.claude',
  filename: 'CLAUDE.md',
  workspaceId: WORKSPACE_ID,
})
import { app, injectWebSocket } from './server.js'

process.on('uncaughtException', (err) => {
  console.error('[fatal] Uncaught exception (process kept alive):', err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[fatal] Unhandled rejection (process kept alive):', reason)
})

interface LoadOutcome {
  allOk: boolean
  /** Skills whose download exhausted retries on this attempt. */
  skillsFailed: string[]
}

async function loadAllConfig(): Promise<LoadOutcome> {
  let allOk = true
  let skillsFailed: string[] = []
  try {
    if (await loadConfig()) {
      console.log('[agent] Config loaded from CP')
    } else {
      allOk = false
    }
  } catch (e) {
    console.error('[agent] Failed to fetch config from CP:', e)
    allOk = false
  }

  try {
    const { ok, failed } = await loadSkills()
    if (ok) {
      console.log('[agent] Skills loaded from CP')
    } else {
      allOk = false
      skillsFailed = failed
    }
  } catch (e) {
    console.error('[agent] Failed to load skills from CP:', e)
    allOk = false
    // Treat list-fetch / unexpected throw as "everything failed" so the outer
    // loop retries and, if it stays broken, the suicide branch fires.
    skillsFailed = ['<list_fetch_failed>']
  }

  try {
    if (await loadCredentials()) {
      console.log('[agent] Credentials loaded from CP')
    } else {
      allOk = false
    }
  } catch (e) {
    console.error('[agent] Failed to load credentials from CP:', e)
    allOk = false
  }
  return { allOk, skillsFailed }
}

// Retry config loading on startup — CP may not be ready yet after a simultaneous restart
const MAX_RETRIES = 5
const RETRY_DELAY_MS = 3000
if (CP_URL) {
  let outcome: LoadOutcome = { allOk: false, skillsFailed: [] }
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    outcome = await loadAllConfig()
    if (outcome.allOk) break
    console.warn(
      `[agent] Config load attempt ${attempt}/${MAX_RETRIES} failed, retrying in ${RETRY_DELAY_MS}ms...`,
    )
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
  }
  if (outcome.skillsFailed.length > 0) {
    // Skill download exhausted both inner per-skill retries and outer
    // loadAllConfig retries. Existing on-disk state was preserved, but rather
    // than serve a degraded workspace silently (the 0zh57cmu incident: 18h of
    // empty .claude/skills/ until the user noticed), exit and let kubelet
    // restart us so we get a fresh shot at the network.
    console.error(
      `[skills] BOOT_FAILED workspace=${WORKSPACE_ID} failed_names=${outcome.skillsFailed.join(',')} — exiting for kubelet restart`,
    )
    process.exit(1)
  }
  if (!outcome.allOk) {
    console.error(
      `[agent] Config load failed after ${MAX_RETRIES} attempts, starting with defaults`,
    )
  }
} else {
  await loadAllConfig()
}

const port = Number.parseInt(process.env.PORT || '3001')
const server = serve({ fetch: app.fetch, port })
injectWebSocket(server)
console.log(`Agent server running on http://localhost:${port}`)

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

// Mount-point for AgentFS shared folders. The afs-fuse sidecar mounts each
// share at /mnt/afs/<name>. Starting dufs unconditionally — when afs is
// disabled the path is just an empty dir (or missing; dufs will recreate).
const AFS_MOUNT_BASE = '/mnt/afs'
function startAfsDufs() {
  startDufs('afs', AFS_MOUNT_BASE, '8001', startAfsDufs)
}
startAfsDufs()
