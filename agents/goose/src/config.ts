/**
 * Configuration loading from the control-plane (CP).
 *
 * Goose variant: writes AGENTS.md (system prompt), ~/.config/goose/config.yaml
 * and runtime.json. Goose gets model/provider config via GOOSE_* / OPENAI_*
 * env vars and MCP servers via ACP session/new (both HTTP and stdio — goose
 * converts them to per-session extensions; there is no config-file MCP path
 * like codex's config.toml, so everything rides the ACP session).
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { McpServer } from '@agentclientprotocol/sdk'
import { SkillManager } from '../../../internal/agent-skills/src/index.js'
import { nodeFetch, nodeFs, nodeShell } from '../../../internal/agent-skills/src/node.js'
import { renderPlatformSkillFiles } from '../../../internal/agent-skills/src/platform.js'
import { writePlatformPrompt } from '../../../internal/platform-prompt/src/index.js'

export const CP_URL = process.env.CP_URL
export const WORKSPACE_ID = process.env.WORKSPACE_ID
export const WORKSPACE_DIR = process.env.WORKSPACE_DIR || '/workspace'

/** Shell-quote a value for use in `export K=V` (single quotes, escape embedded quotes) */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`
}

// env credentials are mutated into this process directly, but interactive
// shells are separate processes that won't see those mutations. Mirror the
// claude-code agent: write the env credentials to a file and have the login /
// interactive shells source it, so a freshly-opened terminal picks them up.
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

/** In-memory store for sensitive fields that must not be written to disk */
let _apiKey = ''

/** Whether the loaded config has any MCP servers (set by loadConfig) */
export let hasMcpServers = false

interface UserMcpServerConfig {
  url?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  headers?: Record<string, string>
}

/**
 * Parsed user MCP servers from cp config. Both HTTP and stdio entries go
 * through the ACP-session path in `loadAcpMcpServers` — goose accepts stdio
 * servers in session/new too, so nothing needs a config-file detour.
 */
let _userMcpServers: Record<string, UserMcpServerConfig> = {}

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
  // Goose reads global context files (AGENTS.md) from ~/.config/goose/.
  writePlatformPrompt({
    agentKind: 'goose',
    homeSubdir: '.config/goose',
    filename: 'AGENTS.md',
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

  // Write system prompt as AGENTS.md (prefer library prompt content over inline)
  const prompt = config.prompt_content || config.system_prompt
  writeFileSync(join(WORKSPACE_DIR, 'AGENTS.md'), prompt)

  // Parse MCP config
  let mcpServers: Record<string, any> = {}
  try {
    const parsed = JSON.parse(config.mcp_config)
    mcpServers = parsed.mcpServers ?? parsed
  } catch {
    // mcp_config might be empty or invalid — that's fine
  }
  _userMcpServers = mcpServers as Record<string, UserMcpServerConfig>
  hasMcpServers = Object.keys(mcpServers).length > 0

  const home = process.env.HOME || '/root'
  const gooseDir = join(home, '.config', 'goose')
  mkdirSync(gooseDir, { recursive: true })

  // Store MCP config as JSON for loadAcpMcpServers() (ACP adapter)
  writeFileSync(join(gooseDir, 'mcp.json'), JSON.stringify({ mcpServers }, null, 2))

  // Write runtime.json (shared format for model/provider info)
  const model = config.model || ''
  const providerType = config.provider_type || ''
  _apiKey = config.api_key || ''
  writeFileSync(
    join(WORKSPACE_DIR, 'runtime.json'),
    JSON.stringify({
      model,
      provider_type: providerType,
      base_url: config.base_url || '',
      small_model: config.small_model || '',
    }),
  )

  // Write ~/.config/goose/config.yaml. Provider/model/mode ride env vars
  // (applyProviderEnv); the config file carries extension toggles and
  // user agent_settings. Platform-enforced: no native memory-like features —
  // memory extension stays unenabled, chat recall ("Chat Recall" platform
  // extension searches past conversations) is explicitly off.
  const agentSettings = (config.agent_settings || '').trim()
  // Goose settings are YAML. Skip JSON (claude-code) and TOML key=value
  // (codex) content left over from a core switch.
  const isYamlAgentSettings =
    agentSettings &&
    agentSettings !== '{}' &&
    !agentSettings.startsWith('{') &&
    !/^\s*[\w.-]+\s*=/m.test(agentSettings)

  const yamlLines = [
    `GOOSE_MODEL: ${JSON.stringify(model)}`,
    'GOOSE_MODE: auto',
    'extensions:',
    '  developer:',
    '    type: builtin',
    '    name: developer',
    '    enabled: true',
    '  memory:',
    '    type: builtin',
    '    name: memory',
    '    enabled: false',
    '  chatrecall:',
    '    type: builtin',
    '    name: chatrecall',
    '    enabled: false',
  ]
  if (isYamlAgentSettings) {
    yamlLines.push('')
    yamlLines.push('# agent_settings')
    yamlLines.push(stripPlatformManagedKeys(agentSettings))
  }
  writeFileSync(join(gooseDir, 'config.yaml'), `${yamlLines.join('\n')}\n`)

  console.log(
    `[agent] Config written: model=${config.model} provider=${config.provider_type} prompt=${prompt.length}chars`,
  )
  return true
}

/**
 * Top-level config.yaml keys the platform writes itself. User agent_settings
 * are appended after the platform block, so a same-name top-level key would
 * either break the YAML parse (duplicate-key error) or silently override an
 * enforced value (e.g. GOOSE_MODE=approve would hang headless turns on
 * permission prompts). Drop those blocks — the whole key line plus its
 * indented continuation lines — and log what was dropped.
 */
const PLATFORM_MANAGED_YAML_KEYS = new Set(['GOOSE_MODEL', 'GOOSE_MODE', 'extensions'])

function stripPlatformManagedKeys(yaml: string): string {
  const kept: string[] = []
  const dropped: string[] = []
  let skipping = false
  for (const line of yaml.split('\n')) {
    const topLevelKey = line.match(/^([A-Za-z_][\w.-]*)\s*:/)
    if (topLevelKey) skipping = PLATFORM_MANAGED_YAML_KEYS.has(topLevelKey[1])
    if (skipping) {
      if (topLevelKey) dropped.push(topLevelKey[1])
    } else {
      kept.push(line)
    }
  }
  if (dropped.length > 0) {
    console.warn(`[agent] agent_settings: dropped platform-managed keys: ${dropped.join(', ')}`)
  }
  return kept.join('\n')
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

  const home = process.env.HOME || '/root'
  _skillManager = new SkillManager({
    cpUrl: CP_URL,
    workspaceId: WORKSPACE_ID,
    // Goose's Summon extension discovers Anthropic-style skills in
    // ~/.agents/skills (global path).
    skillsDir: join(home, '.agents', 'skills'),
    localBase: '/tmp',
    // Drafts (unpublished edits) live here on the persistent workspace volume so
    // they survive pod rebuilds; published skills stay on tmpfs (localBase).
    draftBase: join(WORKSPACE_DIR, '.skills-draft'),
    useSymlink: true,
    filesBrowsePath: '/.home/.agents/skills',
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
        agentKind: 'goose',
      }),
    )
    console.log('[agent] Platform skill installed')
  } catch (e) {
    console.error('[agent] Failed to install platform skill:', e)
    failed.push('__platform__')
  }

  return { ok: failed.length === 0, failed }
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
  const envLines: string[] = []

  // Ensure ~/.ssh exists with correct permissions
  const sshDir = join(home, '.ssh')
  if (!existsSync(sshDir)) {
    mkdirSync(sshDir, { recursive: true, mode: 0o700 })
  }
  chmodSync(sshDir, 0o700)
  const sshConfig = join(sshDir, 'config')
  if (!existsSync(sshConfig)) {
    writeFileSync(sshConfig, 'StrictHostKeyChecking accept-new\n', {
      mode: 0o644,
    })
    console.log('[agent] SSH config created with StrictHostKeyChecking=accept-new')
  }

  for (const cred of credentials) {
    if (cred.status === 'deleting') {
      if (cred.inject === 'env') {
        delete process.env[cred.name]
        console.log(`[agent] Credential cleaned: env ${cred.name}`)
      } else if (cred.inject === 'file' && cred.path) {
        const resolvedPath = cred.path.startsWith('~') ? join(home, cred.path.slice(1)) : cred.path
        try {
          unlinkSync(resolvedPath)
          console.log(`[agent] Credential cleaned: file ${resolvedPath}`)
        } catch {
          // File may not exist
        }
      }
      cleaned++
    } else {
      if (cred.inject === 'env') {
        process.env[cred.name] = cred.value
        // Collect for BASH_ENV file so interactive/child shells also see it
        envLines.push(`export ${cred.name}=${shellQuote(cred.value)}`)
        console.log(`[agent] Credential injected: env ${cred.name}`)
      } else if (cred.inject === 'file' && cred.path) {
        const resolvedPath = cred.path.startsWith('~') ? join(home, cred.path.slice(1)) : cred.path
        const parentDir = dirname(resolvedPath)
        mkdirSync(parentDir, { recursive: true })
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

  // Write env credentials to a file sourced by ~/.bashrc and ~/.profile so
  // interactive terminals (separate shell processes) pick them up.
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

export function loadRuntimeConfig(): RuntimeConfig | null {
  try {
    const rc = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'runtime.json'), 'utf-8'))
    rc.api_key = _apiKey
    return rc
  } catch {
    return null
  }
}

/**
 * Load MCP servers for ACP session.
 *
 * Everything goes through this path with goose — HTTP servers (`tos-platform`
 * plus user-configured ones) so each session can inject its own
 * `X-Session-Token` header, and stdio servers because goose has no
 * config-file MCP path (session/new mcpServers is the only injection point;
 * goose converts entries to session-scoped extensions). cp's MCP proxy
 * translates the session token into `X-Tos-Session-Id` for upstream
 * (third-party) servers, while cp's own `/mcp` endpoint resolves it directly.
 *
 * Note goose rejects SSE-transport servers (streamable HTTP + stdio only).
 */
export function loadAcpMcpServers(sessionToken?: string): McpServer[] {
  if (!CP_URL || !WORKSPACE_ID) return []

  const servers: McpServer[] = []

  // Platform MCP — merge user-configured headers (e.g. X-Builder set via the
  // workspace MCP editor) with platform-controlled ones. User headers go in
  // first so the platform-controlled ones win on any name collision.
  const platformHeaders = new Map<string, string>()
  const userPlatform = _userMcpServers['tos-platform']
  if (userPlatform?.headers) {
    for (const [k, v] of Object.entries(userPlatform.headers)) {
      if (typeof v === 'string') platformHeaders.set(k, v)
    }
  }
  platformHeaders.set('X-Workspace-ID', WORKSPACE_ID)
  platformHeaders.set('X-Agent-ID', WORKSPACE_ID)
  if (sessionToken) platformHeaders.set('X-Session-Token', sessionToken)
  servers.push({
    type: 'http',
    name: 'tos-platform',
    url: `${CP_URL}/mcp`,
    headers: Array.from(platformHeaders, ([name, value]) => ({ name, value })),
  })

  for (const [name, cfg] of Object.entries(_userMcpServers)) {
    if (name === 'tos-platform') continue
    if (cfg.url) {
      // User-configured HTTP MCPs — go through cp proxy. Inject X-Session-Token
      // so the proxy can translate it into X-Tos-Session-Id for upstream.
      const headers = new Map<string, string>()
      if (cfg.headers) {
        for (const [k, v] of Object.entries(cfg.headers)) {
          if (typeof v === 'string') headers.set(k, v)
        }
      }
      if (sessionToken) headers.set('X-Session-Token', sessionToken)
      servers.push({
        type: 'http',
        name,
        url: cfg.url,
        headers: Array.from(headers, ([n, v]) => ({ name: n, value: v })),
      })
    } else if (cfg.command) {
      // Stdio MCPs — local processes, injected per-session too. Note the ACP
      // stdio variant carries no `type` discriminant (spec legacy shape).
      servers.push({
        name,
        command: cfg.command,
        args: cfg.args ?? [],
        env: Object.entries(cfg.env ?? {}).map(([n, v]) => ({
          name: n,
          value: v,
        })),
      })
    }
  }

  return servers
}

/**
 * Apply provider environment variables for goose.
 * Dev scope: OpenAI-compatible chat-completions endpoints only
 * (GOOSE_PROVIDER=openai + OPENAI_HOST/OPENAI_BASE_PATH for custom base_url).
 */
export function applyProviderEnv(rc: RuntimeConfig): void {
  // biome-ignore lint/performance/noDelete: env vars must be removed, not set to "undefined"
  delete process.env.ANTHROPIC_API_KEY
  // biome-ignore lint/performance/noDelete: env vars must be removed, not set to "undefined"
  delete process.env.ANTHROPIC_BASE_URL
  // biome-ignore lint/performance/noDelete: env vars must be removed, not set to "undefined"
  delete process.env.OPENAI_API_KEY
  // biome-ignore lint/performance/noDelete: env vars must be removed, not set to "undefined"
  delete process.env.OPENAI_HOST
  // biome-ignore lint/performance/noDelete: env vars must be removed, not set to "undefined"
  delete process.env.OPENAI_BASE_PATH
  // biome-ignore lint/performance/noDelete: env vars must be removed, not set to "undefined"
  delete process.env.GOOSE_FAST_MODEL

  process.env.GOOSE_PROVIDER = 'openai'
  process.env.GOOSE_MODEL = rc.model
  process.env.GOOSE_MODE = 'auto'
  // Sessions/config live on the workspace volume via $HOME redirect; the
  // system keyring doesn't exist in the container.
  process.env.GOOSE_DISABLE_KEYRING = '1'
  // Goose sends no User-Agent at all by default (reqwest never gets
  // .user_agent()); gateways that identify apps by UA see anonymous traffic.
  // OPENAI_CUSTOM_HEADERS (comma-separated Key=Value pairs, resolved from env
  // like OPENAI_API_KEY) rides every chat/completions request. Env wins over
  // config.yaml in goose, so this is platform-enforced — a user-set
  // OPENAI_CUSTOM_HEADERS in agent_settings would be shadowed.
  process.env.OPENAI_CUSTOM_HEADERS = 'User-Agent=agent-platform-goose/1.0'
  // Goose's own UI niceties that each cost an extra LLM call: an
  // AI-generated title per tool call and an AI-generated session name per
  // session. The platform renders tool calls itself and cp owns session
  // naming, so both are pure waste here.
  process.env.GOOSE_DISABLE_TOOL_CALL_SUMMARY = '1'
  process.env.GOOSE_DISABLE_SESSION_NAMING = '1'

  if (rc.api_key) {
    process.env.OPENAI_API_KEY = rc.api_key
  }
  if (rc.small_model) {
    // Route goose's auxiliary calls (classification, summaries it still
    // makes) to the provider's configured small model instead of the main one.
    process.env.GOOSE_FAST_MODEL = rc.small_model
  }
  if (rc.base_url) {
    // Goose splits the endpoint into host + path: OPENAI_HOST is the origin,
    // OPENAI_BASE_PATH the full path to chat/completions.
    try {
      const u = new URL(rc.base_url)
      process.env.OPENAI_HOST = u.origin
      const basePath = u.pathname.replace(/\/+$/, '')
      process.env.OPENAI_BASE_PATH = `${basePath.replace(/^\/+/, '')}/chat/completions`
    } catch {
      console.error(`[agent] Invalid base_url, ignoring: ${rc.base_url}`)
    }
  }
}
