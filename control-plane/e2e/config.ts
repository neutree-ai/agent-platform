import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

// ---------------------------------------------------------------------------
// E2E profile
// ---------------------------------------------------------------------------
// The suite runs REMOTE: it points at an already-deployed control plane and
// never touches the database or spawns a process. Everything environment
// specific — target URL, admin credentials, which LLM to talk to — comes from
// a profile file so no deployment detail is baked into the repo.
//
//   E2E_PROFILE=./e2e/profile.local.json npm run test:e2e
//
// See profile.example.json for the full shape. Individual fields can be
// overridden by environment variables (handy for CI secrets), listed per field
// below.

interface E2eLlmConfig {
  /** Provider type as understood by the control plane, e.g. 'anthropic-oauth'. */
  providerType: string
  /** OpenAI-compatible base URL of the model endpoint. */
  baseUrl: string
  /** API key for the endpoint. */
  apiKey: string
  /** Model identifier to run conversations against. */
  model: string
  /**
   * Agent cores to exercise. Every spec that drives a live agent runs once per
   * entry, so this is what decides how wide the matrix is. Each core must be
   * one the deployment ships AND must speak the endpoint's protocol — an
   * OpenAI-compatible endpoint needs a core on the OpenAI chat path.
   */
  agentTypes: string[]
}

interface E2eCapabilities {
  /**
   * Target is backed by a real Kubernetes cluster, so workspaces can actually
   * reach `running`. Without this, workspace lifecycle and everything that
   * needs a live agent (sessions, shares, jobs) is skipped.
   */
  kubernetes: boolean
  /** Target was installed with the sandbox component enabled. */
  sandbox: boolean
  /** Target was installed with the browser component enabled. */
  browser: boolean
}

export interface E2eProfile {
  /** Base URL of the deployed control plane, e.g. http://10.0.0.5:30080 */
  baseUrl: string
  admin: {
    username: string
    password: string
  }
  llm: E2eLlmConfig
  capabilities: E2eCapabilities
  /**
   * Explicit acknowledgement that the suite creates and deletes real data on
   * the target. Must be true — there is no default that lets an unconfigured
   * run mutate a cluster.
   */
  confirmMutatesTarget: boolean
  /**
   * By default the suite refuses to run against a target that already has
   * users beyond the admin account, on the assumption that a populated target
   * is somebody's real deployment. Set true to run against a shared dev
   * cluster anyway.
   */
  allowNonPristineTarget: boolean
  /** Where failure diagnostics are written. Relative paths resolve to cwd. */
  artifactsDir: string
}

const REQUIRED_PATHS = [
  'baseUrl',
  'admin.username',
  'admin.password',
  'llm.providerType',
  'llm.baseUrl',
  'llm.apiKey',
  'llm.model',
] as const

function pick(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key]
    return undefined
  }, obj)
}

function envOverride(profile: Record<string, unknown>) {
  const set = (path: string, value: string | undefined) => {
    if (value === undefined || value === '') return
    const keys = path.split('.')
    const last = keys.pop() as string
    let cursor = profile
    for (const key of keys) {
      if (typeof cursor[key] !== 'object' || cursor[key] === null) cursor[key] = {}
      cursor = cursor[key] as Record<string, unknown>
    }
    cursor[last] = value
  }

  // Comma-separated in the environment, an array in the profile file.
  const setList = (path: string, value: string | undefined) => {
    if (value === undefined || value === '') return
    const keys = path.split('.')
    const last = keys.pop() as string
    let cursor = profile
    for (const key of keys) {
      if (typeof cursor[key] !== 'object' || cursor[key] === null) cursor[key] = {}
      cursor = cursor[key] as Record<string, unknown>
    }
    cursor[last] = value
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
  }

  set('baseUrl', process.env.E2E_BASE_URL)
  set('admin.username', process.env.E2E_ADMIN_USERNAME)
  set('admin.password', process.env.E2E_ADMIN_PASSWORD)
  set('llm.providerType', process.env.E2E_LLM_PROVIDER_TYPE)
  set('llm.baseUrl', process.env.E2E_LLM_BASE_URL)
  set('llm.apiKey', process.env.E2E_LLM_API_KEY)
  set('llm.model', process.env.E2E_LLM_MODEL)
  setList('llm.agentTypes', process.env.E2E_LLM_AGENT_TYPES)
}

let cached: E2eProfile | undefined

export function loadProfile(): E2eProfile {
  if (cached) return cached

  const profilePath = process.env.E2E_PROFILE
  let raw: Record<string, unknown> = {}

  if (profilePath) {
    const abs = isAbsolute(profilePath) ? profilePath : resolve(process.cwd(), profilePath)
    try {
      raw = JSON.parse(readFileSync(abs, 'utf-8'))
    } catch (err) {
      throw new Error(`E2E_PROFILE could not be read at ${abs}: ${(err as Error).message}`)
    }
  }

  envOverride(raw)

  const missing = REQUIRED_PATHS.filter((p) => {
    const v = pick(raw, p)
    return v === undefined || v === null || v === ''
  })
  if (missing.length > 0) {
    throw new Error(
      [
        'E2E profile is incomplete. Missing:',
        ...missing.map((m) => `  - ${m}`),
        '',
        'Point E2E_PROFILE at a profile file (see e2e/profile.example.json)',
        'or supply the matching E2E_* environment variables.',
      ].join('\n'),
    )
  }

  const agentTypes = (raw.llm as { agentTypes?: unknown } | undefined)?.agentTypes
  if (!Array.isArray(agentTypes) || agentTypes.length === 0) {
    throw new Error(
      'E2E profile needs a non-empty llm.agentTypes array — it decides which agent ' +
        'cores the live-agent specs run against (e.g. ["goose"]).',
    )
  }

  const capabilities = (raw.capabilities ?? {}) as Partial<E2eCapabilities>

  cached = {
    baseUrl: String(raw.baseUrl).replace(/\/$/, ''),
    admin: raw.admin as E2eProfile['admin'],
    llm: { ...(raw.llm as E2eLlmConfig), agentTypes: agentTypes as string[] },
    capabilities: {
      kubernetes: capabilities.kubernetes ?? true,
      sandbox: capabilities.sandbox ?? true,
      browser: capabilities.browser ?? true,
    },
    confirmMutatesTarget: raw.confirmMutatesTarget === true,
    allowNonPristineTarget: raw.allowNonPristineTarget === true,
    artifactsDir: String(raw.artifactsDir ?? './e2e-artifacts'),
  }

  return cached
}
