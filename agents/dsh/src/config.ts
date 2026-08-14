/**
 * Configuration loading from the control-plane (CP).
 *
 * dsh variant: the platform's settings become a generated cordis composition
 * (see `cordis.ts`) plus a small set of environment variables the runtime reads
 * at boot. Nothing model-facing is negotiated over the wire — the model route,
 * persona, skills root, and MCP servers are all composition.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { SkillManager } from '../../../internal/agent-skills/src/index.js'
import { nodeFetch, nodeFs, nodeShell } from '../../../internal/agent-skills/src/node.js'
import { renderPlatformSkillFiles } from '../../../internal/agent-skills/src/platform.js'
import type { DshLaunchSpec } from '../../../internal/dsh-adapter/index.js'
import {
  renderPlatformPrompt,
  writePlatformPrompt,
} from '../../../internal/platform-prompt/src/index.js'
import { captureWorkspaceToken } from '../../../internal/types/workspace-token.js'
import { APP_DIR, type McpServerSpec, writeCordisConfig } from './cordis.js'

export const CP_URL = process.env.CP_URL
export const WORKSPACE_ID = process.env.WORKSPACE_ID
export const WORKSPACE_DIR = process.env.WORKSPACE_DIR || '/workspace'

/** Session logs live on the workspace volume so a pod restart can resume them. */
const SESSION_ROOT = join(WORKSPACE_DIR, '.dsh-sessions')

/** The env var the generated composition points `apiKeyEnv` at. */
const PROVIDER_KEY_ENV = 'PLATFORM_MODEL_API_KEY'

const WORKSPACE_TOKEN = captureWorkspaceToken()

export function cpAuthHeaders(): Record<string, string> {
  return WORKSPACE_TOKEN ? { Authorization: `Bearer ${WORKSPACE_TOKEN}` } : {}
}

export function cpWorkspaceUrl(suffix: string): string {
  return `${CP_URL}/workspace/v1/workspaces/${WORKSPACE_ID}/${suffix}`
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`
}

const CRED_ENV_FILE = join(process.env.HOME || '/root', '.agent-credentials.env')
const CRED_SOURCE_LINE = `[ -f "${CRED_ENV_FILE}" ] && . "${CRED_ENV_FILE}"`

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

/** Kept in memory: the model key belongs in the runtime's env, not on disk. */
let _apiKey = ''
let _systemPrompt = ''
let _platformPrompt = ''
let _userDisplayName: string | undefined

interface UserMcpServerConfig {
  url?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  headers?: Record<string, string>
}

let _userMcpServers: Record<string, UserMcpServerConfig> = {}

/**
 * dsh receives MCP servers through its composition, not through a session
 * handshake, so the server skeleton has nothing to negotiate.
 */
export const hasMcpServers = false

/**
 * The per-session proxy token cp mints for MCP calls. The server skeleton hands
 * it over through the MCP hook just before the session starts; the runtime is
 * spawned lazily on the first prompt, by which time it is here.
 */
let _sessionToken: string | undefined

/** Hook shape the server skeleton calls with the session's token. */
export function captureSessionToken(sessionToken?: string): [] {
  if (sessionToken !== undefined) _sessionToken = sessionToken
  return []
}

export async function loadConfig(): Promise<boolean> {
  if (!CP_URL || !WORKSPACE_ID) {
    console.log(
      `[agent] Config skipped: CP_URL=${CP_URL ?? '(unset)'} WORKSPACE_ID=${WORKSPACE_ID ?? '(unset)'}`,
    )
    return false
  }
  const url = cpWorkspaceUrl('config')
  const resp = await fetch(url, { headers: cpAuthHeaders() })
  if (!resp.ok) {
    console.error(`[agent] Config fetch failed: ${resp.status} ${resp.statusText} url=${url}`)
    return false
  }
  const config = await resp.json()

  if (config.user_display_name) _userDisplayName = config.user_display_name

  const promptOptions = {
    agentKind: 'dsh' as const,
    homeSubdir: '.dsh',
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
  }
  // Written for the same reason the other cores write it — the file is the
  // user-visible record of what the platform told their agent — but dsh does
  // not read context files here, so the persona below is what actually lands.
  writePlatformPrompt(promptOptions)
  _platformPrompt = renderPlatformPrompt(promptOptions)

  const userPrompt = config.prompt_content || config.system_prompt || ''
  writeFileSync(join(WORKSPACE_DIR, 'AGENTS.md'), userPrompt)
  // dsh's persona is the whole system prompt: its AGENTS.md loader stays off
  // (`workspaceContext: false`), so anything not in here never reaches the
  // model. Platform guidance first, then the user's own, which is the same
  // precedence the other cores get from a global context file plus a workspace
  // one.
  _systemPrompt = [_platformPrompt, userPrompt].filter(Boolean).join('\n\n')

  let mcpServers: Record<string, any> = {}
  try {
    const parsed = JSON.parse(config.mcp_config)
    mcpServers = parsed.mcpServers ?? parsed
  } catch {
    // mcp_config might be empty or invalid — that's fine
  }
  _userMcpServers = mcpServers as Record<string, UserMcpServerConfig>

  _apiKey = config.api_key || ''
  writeFileSync(
    join(WORKSPACE_DIR, 'runtime.json'),
    JSON.stringify({
      model: config.model || '',
      provider_type: config.provider_type || '',
      base_url: config.base_url || '',
      small_model: config.small_model || '',
    }),
  )

  console.log(
    `[agent] Config written: model=${config.model} provider=${config.provider_type} prompt=${_systemPrompt.length}chars`,
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

  const home = process.env.HOME || '/root'
  _skillManager = new SkillManager({
    cpUrl: CP_URL,
    workspaceId: WORKSPACE_ID,
    cpHeaders: cpAuthHeaders(),
    // dsh's filesystem skill provider scans `<agentsHome>/skills`, which
    // defaults to ~/.agents/skills — the same root the platform already
    // installs into for goose.
    skillsDir: join(home, '.agents', 'skills'),
    localBase: '/tmp',
    draftBase: join(WORKSPACE_DIR, '.skills-draft'),
    useSymlink: true,
    filesBrowsePath: '/.home/.agents/skills',
    fetch: nodeFetch,
    fs: nodeFs,
    shell: nodeShell,
  })

  const { loaded, failed } = await _skillManager.load()
  console.log(`[agent] Skills loaded: ${loaded.length} total (${loaded.join(', ')})`)

  try {
    await _skillManager.installPlatformSkill(
      renderPlatformSkillFiles({
        workspaceId: WORKSPACE_ID,
        userName: _userDisplayName,
        agentKind: 'dsh',
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
  const url = cpWorkspaceUrl('credentials')
  const resp = await fetch(url, { headers: cpAuthHeaders() })
  if (!resp.ok) {
    console.error(`[agent] Credentials fetch failed: ${resp.status} ${resp.statusText} url=${url}`)
    return false
  }
  const credentials: Credential[] = await resp.json()

  const home = process.env.HOME || '/root'
  let injected = 0
  let cleaned = 0
  const envLines: string[] = []

  const sshDir = join(home, '.ssh')
  if (!existsSync(sshDir)) mkdirSync(sshDir, { recursive: true, mode: 0o700 })
  chmodSync(sshDir, 0o700)
  const sshConfig = join(sshDir, 'config')
  if (!existsSync(sshConfig)) {
    writeFileSync(sshConfig, 'StrictHostKeyChecking accept-new\n', { mode: 0o644 })
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
        envLines.push(`export ${cred.name}=${shellQuote(cred.value)}`)
        console.log(`[agent] Credential injected: env ${cred.name}`)
      } else if (cred.inject === 'file' && cred.path) {
        const resolvedPath = cred.path.startsWith('~') ? join(home, cred.path.slice(1)) : cred.path
        const parentDir = dirname(resolvedPath)
        mkdirSync(parentDir, { recursive: true })
        if (resolvedPath.startsWith(sshDir)) chmodSync(parentDir, 0o700)
        const fileMode = cred.mode ? Number.parseInt(cred.mode, 8) : 0o600
        writeFileSync(resolvedPath, cred.value, { mode: fileMode })
        console.log(
          `[agent] Credential injected: file ${resolvedPath} (mode=${cred.mode || '0600'})`,
        )
      }
      injected++
    }
  }

  if (envLines.length > 0) {
    writeFileSync(CRED_ENV_FILE, `${envLines.join('\n')}\n`, { mode: 0o600 })
    process.env.BASH_ENV = CRED_ENV_FILE
    ensureShellSourceLine()
    console.log(`[agent] Credentials env file written: ${CRED_ENV_FILE} (${envLines.length} vars)`)
  } else {
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
 * Platform provider types → the pi-ai wire protocols. Anything else is a
 * configuration the platform cannot describe to dsh, and failing here beats
 * guessing a dialect and getting silently wrong requests.
 */
function providerApi(providerType: string): string {
  switch (providerType) {
    case 'anthropic':
      return 'anthropic-messages'
    // The platform's two OpenAI flavours are distinct wire protocols, not a
    // default plus a variant: `openai` is the Responses API, `openai-chat` is
    // Chat Completions. pi-ai implements both, so neither has to be coerced.
    case 'openai':
      return 'openai-responses'
    case 'openai-chat':
      return 'openai-completions'
    default:
      throw new Error(`dsh agent cannot serve provider_type "${providerType}"`)
  }
}

/**
 * The platform MCP hop plus the user's own servers, shaped for the generated
 * composition. HTTP entries carry the session token so cp's proxy can resolve
 * the session on the way out; stdio entries are local processes and need none.
 */
function buildMcpServers(): McpServerSpec[] {
  if (!CP_URL || !WORKSPACE_ID) return []
  const servers: McpServerSpec[] = []

  const platformHeaders: Record<string, string> = {}
  for (const [k, v] of Object.entries(_userMcpServers['tos-platform']?.headers ?? {})) {
    if (typeof v === 'string') platformHeaders[k] = v
  }
  platformHeaders['X-Workspace-ID'] = WORKSPACE_ID
  platformHeaders['X-Agent-ID'] = WORKSPACE_ID
  if (_sessionToken !== undefined) platformHeaders['X-Session-Token'] = _sessionToken
  servers.push({ name: 'platform', url: `${CP_URL}/mcp`, headers: platformHeaders })

  for (const [name, cfg] of Object.entries(_userMcpServers)) {
    if (name === 'tos-platform') continue
    if (cfg.url) {
      const headers: Record<string, string> = {}
      for (const [k, v] of Object.entries(cfg.headers ?? {})) {
        if (typeof v === 'string') headers[k] = v
      }
      if (_sessionToken !== undefined) headers['X-Session-Token'] = _sessionToken
      servers.push({ name, url: cfg.url, headers })
    } else if (cfg.command) {
      servers.push({ name, command: cfg.command, args: cfg.args ?? [], env: cfg.env ?? {} })
    }
  }
  return servers
}

/**
 * Everything one runtime process needs, resolved at spawn time so a reloaded
 * config and a freshly minted session token both land on the next turn.
 */
export function buildLaunchSpec(sessionId: string): DshLaunchSpec {
  const rc = loadRuntimeConfig()
  if (!rc) throw new Error('dsh agent has no runtime config — cp config was never loaded')

  const configPath = writeCordisConfig({
    sessionId,
    workspaceDir: WORKSPACE_DIR,
    sessionRoot: SESSION_ROOT,
    provider: {
      api: providerApi(rc.provider_type),
      baseUrl: rc.base_url ?? '',
      model: rc.model,
      apiKeyEnv: PROVIDER_KEY_ENV,
    },
    mcpServers: buildMcpServers(),
  })

  return {
    command: process.execPath,
    args: [join(APP_DIR, 'node_modules', '@deepseek-ai', 'dsh-sdk-jsonrpc-demo', 'lib', 'bin.js')],
    env: {
      ...(Object.fromEntries(
        Object.entries(process.env).filter(([, v]) => v !== undefined),
      ) as Record<string, string>),
      DSH_CORDIS_CONFIG: configPath,
      DSH_CWD: WORKSPACE_DIR,
      DSH_SESSION_ROOT: SESSION_ROOT,
      DSH_SYSTEM_PROMPT: _systemPrompt,
      [PROVIDER_KEY_ENV]: rc.api_key ?? '',
    },
    provider: 'platform',
    model: rc.model,
  }
}
