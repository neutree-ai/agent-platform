import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { writePlatformPrompt } from '../../../internal/platform-prompt/src/index.js'
import { SkillManager } from '../../../internal/agent-skills/src/index.js'
import { nodeFetch, nodeFs, nodeShell } from '../../../internal/agent-skills/src/node.js'
import { renderPlatformSkillFiles } from '../../../internal/agent-skills/src/platform.js'

export const CP_URL = process.env.CP_URL
export const WORKSPACE_ID = process.env.WORKSPACE_ID
export const WORKSPACE_DIR = process.env.WORKSPACE_DIR || '/workspace'

export interface UserMcpServerConfig {
  type?: 'http' | 'sse' | 'stdio'
  url?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  headers?: Record<string, string>
}

/**
 * Parsed user MCP servers from cp's `/_cp/workspaces/:id/config`. Cached
 * in memory so `agent.ts` can merge them into the per-turn `mcpServers`
 * arg and inject `X-Session-Token` without re-parsing `.mcp.json` from
 * disk on every turn.
 */
let _userMcpServers: Record<string, UserMcpServerConfig> = {}

export function getUserMcpServers(): Record<string, UserMcpServerConfig> {
  return _userMcpServers
}

// Cached so reload-only paths (skills refresh without re-fetching workspace
// config) can still render the platform skill with the user's display name.
let _userDisplayName: string | undefined

export async function loadConfig(): Promise<boolean> {
  if (!CP_URL || !WORKSPACE_ID) {
    console.log(
      `[agent] Config skipped: CP_URL=${CP_URL ?? '(unset)'} WORKSPACE_ID=${WORKSPACE_ID ?? '(unset)'}`,
    )
    return false
  }
  const url = `${CP_URL}/_cp/workspaces/${WORKSPACE_ID}/config`
  const resp = await fetch(url)
  if (!resp.ok) {
    console.error(`[agent] Config fetch failed: ${resp.status} ${resp.statusText} url=${url}`)
    return false
  }
  const config = await resp.json()
  if (config.user_display_name) {
    _userDisplayName = config.user_display_name
  }
  // Always re-render the platform prompt on config fetch — memory attachments
  // and instructions can change between fetches independently of display name.
  writePlatformPrompt({
    agentKind: 'claude-code',
    homeSubdir: '.claude',
    filename: 'CLAUDE.md',
    workspaceId: WORKSPACE_ID,
    userName: _userDisplayName,
    memoryAttachments: (config.memory_attachments ?? []).map((a: any) => ({
      storeId: a.store_id,
      storeName: a.store_name,
      storeDescription: a.store_description ?? '',
      access: a.access,
      instructions: a.instructions ?? '',
      indexContent: a.index_content ?? null,
    })),
  })
  writeFileSync(join(WORKSPACE_DIR, 'CLAUDE.md'), config.prompt_content || config.system_prompt)
  writeFileSync(join(WORKSPACE_DIR, '.mcp.json'), config.mcp_config)
  try {
    const parsed = JSON.parse(config.mcp_config)
    _userMcpServers = (parsed?.mcpServers ?? {}) as Record<string, UserMcpServerConfig>
  } catch {
    _userMcpServers = {}
  }
  // Clear Claude Code's MCP needs-auth cache so updated MCP servers are retried immediately
  const mcpAuthCache = join(process.env.HOME || '/root', '.claude', 'mcp-needs-auth-cache.json')
  try {
    unlinkSync(mcpAuthCache)
  } catch {}
  mkdirSync(join(WORKSPACE_DIR, '.claude'), { recursive: true })
  // Merge platform-enforced settings into user-provided agent_settings
  let agentSettings: Record<string, any> = {}
  try {
    agentSettings = JSON.parse(config.agent_settings || '{}')
  } catch {}
  agentSettings.autoMemoryEnabled = false
  writeFileSync(
    join(WORKSPACE_DIR, '.claude/settings.json'),
    JSON.stringify(agentSettings, null, 2),
  )
  // Store api_key in memory only (never written to disk)
  _apiKey = config.api_key || ''
  writeFileSync(
    join(WORKSPACE_DIR, 'runtime.json'),
    JSON.stringify({
      model: config.model,
      provider_type: config.provider_type,
      base_url: config.base_url || '',
      small_model: config.small_model || '',
    }),
  )
  console.log(
    `[agent] Config written: model=${config.model} provider=${config.provider_type} prompt=${config.system_prompt.length}chars mcp=${config.mcp_config.length}chars`,
  )
  return true
}

let _skillManager: SkillManager | null = null

export function getSkillManager(): SkillManager | null {
  return _skillManager
}

export async function loadSkills(): Promise<{ ok: boolean; failed: string[] }> {
  if (!CP_URL || !WORKSPACE_ID) {
    console.log(
      `[agent] Skills skipped: CP_URL=${CP_URL ?? '(unset)'} WORKSPACE_ID=${WORKSPACE_ID ?? '(unset)'}`,
    )
    return { ok: false, failed: [] }
  }

  _skillManager = new SkillManager({
    cpUrl: CP_URL,
    workspaceId: WORKSPACE_ID,
    skillsDir: join(WORKSPACE_DIR, '.claude', 'skills'),
    localBase: '/tmp',
    useSymlink: true,
    fetch: nodeFetch,
    fs: nodeFs,
    shell: nodeShell,
  })

  const { loaded, failed } = await _skillManager.load()
  console.log(`[agent] Skills loaded: ${loaded.length} total (${loaded.join(', ')})`)

  // Stamp the platform-managed `__platform__` skill on top. Done after load()
  // so its sweeps run first (they skip reserved names, but ordering keeps the
  // intent explicit: user skills resolve from CP, then the platform layer goes
  // down readonly). Failure counts as a load failure: the agent without
  // `__platform__` can't describe its workspace capabilities, so kicking
  // outer retry + kubelet restart is the right move.
  try {
    await _skillManager.installPlatformSkill(
      renderPlatformSkillFiles({
        workspaceId: WORKSPACE_ID,
        userName: _userDisplayName,
        agentKind: 'claude-code',
      }),
    )
    console.log('[agent] Platform skill installed')
  } catch (e) {
    console.error('[agent] Failed to install platform skill:', e)
    failed.push('__platform__')
  }

  return { ok: failed.length === 0, failed }
}

/** Shell-quote a value for use in `export K=V` (single quotes, escape embedded quotes) */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`
}

const CRED_ENV_FILE = join(process.env.HOME || '/root', '.agent-credentials.env')
const CRED_SOURCE_LINE = `[ -f "${CRED_ENV_FILE}" ] && . "${CRED_ENV_FILE}"`

/** Ensure ~/.bashrc and ~/.profile source the credentials env file (idempotent) */
function ensureShellSourceLine(): void {
  const home = process.env.HOME || '/root'
  for (const rc of [join(home, '.bashrc'), join(home, '.profile')]) {
    let content = ''
    try {
      content = readFileSync(rc, 'utf-8')
    } catch {}
    if (!content.includes(CRED_SOURCE_LINE)) {
      const sep = content.endsWith('\n') || !content ? '' : '\n'
      writeFileSync(rc, `${content}${sep}${CRED_SOURCE_LINE}\n`)
    }
  }
}

interface Credential {
  name: string
  value: string
  inject: string
  path: string | null
  mode: string | null
  status: string
}

export async function loadCredentials(): Promise<boolean> {
  if (!CP_URL || !WORKSPACE_ID) {
    console.log(
      `[agent] Credentials skipped: CP_URL=${CP_URL ?? '(unset)'} WORKSPACE_ID=${WORKSPACE_ID ?? '(unset)'}`,
    )
    return false
  }
  const url = `${CP_URL}/_cp/workspaces/${WORKSPACE_ID}/credentials`
  const resp = await fetch(url)
  if (!resp.ok) {
    console.error(`[agent] Credentials fetch failed: ${resp.status} ${resp.statusText} url=${url}`)
    return false
  }
  const credentials: Credential[] = await resp.json()

  const home = process.env.HOME || '/root'
  let injected = 0
  let cleaned = 0

  // Ensure ~/.ssh exists with correct permissions (0700) and has a base config
  const sshDir = join(home, '.ssh')
  if (!existsSync(sshDir)) {
    mkdirSync(sshDir, { recursive: true, mode: 0o700 })
  }
  chmodSync(sshDir, 0o700)
  const sshConfig = join(sshDir, 'config')
  if (!existsSync(sshConfig)) {
    writeFileSync(sshConfig, 'StrictHostKeyChecking accept-new\n', { mode: 0o644 })
    console.log('[agent] SSH config created with StrictHostKeyChecking=accept-new')
  }

  const envLines: string[] = []

  for (const cred of credentials) {
    if (cred.status === 'deleting') {
      // Cleanup: remove previously injected env var or file
      if (cred.inject === 'env') {
        delete process.env[cred.name]
        console.log(`[agent] Credential cleaned: env ${cred.name}`)
      } else if (cred.inject === 'file' && cred.path) {
        const resolvedPath = cred.path.startsWith('~') ? join(home, cred.path.slice(1)) : cred.path
        try {
          unlinkSync(resolvedPath)
          console.log(`[agent] Credential cleaned: file ${resolvedPath}`)
        } catch {
          // File may not exist — already cleaned or never written
        }
      }
      cleaned++
    } else {
      // Active: inject
      if (cred.inject === 'env') {
        process.env[cred.name] = cred.value
        // Collect for BASH_ENV file so child bash processes also see it
        envLines.push(`export ${cred.name}=${shellQuote(cred.value)}`)
        console.log(`[agent] Credential injected: env ${cred.name}`)
      } else if (cred.inject === 'file' && cred.path) {
        const resolvedPath = cred.path.startsWith('~') ? join(home, cred.path.slice(1)) : cred.path
        const parentDir = dirname(resolvedPath)
        mkdirSync(parentDir, { recursive: true })
        // Ensure directories under ~/.ssh have restrictive permissions (SSH requires 0700)
        if (resolvedPath.startsWith(sshDir)) {
          chmodSync(parentDir, 0o700)
        }
        const fileMode = cred.mode ? Number.parseInt(cred.mode, 8) : 0o600
        writeFileSync(resolvedPath, cred.value, { mode: fileMode })
        console.log(
          `[agent] Credential injected: file ${resolvedPath} (mode=${cred.mode || '0600'})`,
        )
      }
      injected++
    }
  }

  // Write env credentials to a file sourced by ~/.bashrc and ~/.profile
  if (envLines.length > 0) {
    writeFileSync(CRED_ENV_FILE, `${envLines.join('\n')}\n`, { mode: 0o600 })
    process.env.BASH_ENV = CRED_ENV_FILE
    ensureShellSourceLine()
    console.log(`[agent] Credentials env file written: ${CRED_ENV_FILE} (${envLines.length} vars)`)
  } else {
    // No env credentials — write empty file (don't delete, source line is harmless)
    writeFileSync(CRED_ENV_FILE, '', { mode: 0o600 })
  }

  console.log(`[agent] Credentials loaded: ${injected} injected, ${cleaned} cleaned`)
  return true
}

export interface RuntimeConfig {
  model: string
  provider_type: string
  base_url?: string
  api_key?: string
  small_model?: string
}

/** In-memory store for sensitive fields that must not be written to disk */
let _apiKey = ''

export function loadRuntimeConfig(): RuntimeConfig | null {
  try {
    const rc = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'runtime.json'), 'utf-8'))
    rc.api_key = _apiKey
    return rc
  } catch {
    return null
  }
}

export function applyProviderEnv(rc: RuntimeConfig): void {
  // Clear previous values
  // biome-ignore lint/performance/noDelete: env vars must be removed, not set to "undefined"
  delete process.env.ANTHROPIC_API_KEY
  // biome-ignore lint/performance/noDelete: env vars must be removed, not set to "undefined"
  delete process.env.ANTHROPIC_BASE_URL
  // biome-ignore lint/performance/noDelete: env vars must be removed, not set to "undefined"
  delete process.env.ANTHROPIC_AUTH_TOKEN
  // biome-ignore lint/performance/noDelete: env vars must be removed, not set to "undefined"
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN

  if (rc.provider_type === 'anthropic') {
    process.env.ANTHROPIC_API_KEY = rc.api_key || ''
    process.env.ANTHROPIC_BASE_URL = rc.base_url || ''
  } else if (rc.provider_type === 'anthropic-oauth') {
    process.env.ANTHROPIC_API_KEY = ''
    process.env.ANTHROPIC_AUTH_TOKEN = rc.api_key || ''
    process.env.ANTHROPIC_BASE_URL = rc.base_url || ''
  } else if (rc.provider_type === 'claude-code-oauth') {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = rc.api_key || ''
  }
  // openai → not supported by claude-code, no env vars set

  if (rc.small_model) {
    process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = rc.small_model
  } else {
    // biome-ignore lint/performance/noDelete: env vars must be removed, not set to "undefined"
    delete process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL
  }
}
