// The application protocol (/apps/v1): an application registered on the
// platform provisions its own users and acts as them, with its client id and
// secret alone. Each of its users is a platform user that can't sign in to the
// platform itself. The application groups its users into teams, publishes
// prompts and skills, and declares in its spec the agents each user gets.

import { NapClient, NapError } from './client.js'

export interface AppClientOptions {
  /** Platform base URL, e.g. https://nap.example.com */
  baseUrl: string
  clientId: string
  clientSecret: string
  fetch?: typeof fetch
}

export interface AppUser {
  /** The platform's user id. */
  id: string
  /** Your application's id for the user. */
  external_id: string
  username: string
  display_name: string
  email: string | null
  created_at: string
}

export interface AppTeam {
  /** The platform's team id, as folder sharing names it. */
  id: string
  /** Your application's id for the team. */
  external_id: string
  name: string
  description: string | null
  created_at: string
}

export interface AppPrompt {
  name: string
  /** Goes up each time the text changes. */
  version: number
  updated_at: string
}

export interface AppSkill {
  name: string
  description: string
  /** Goes up each time a package with new content is published. */
  version: number
  content_hash: string
  updated_at: string
}

export interface SpecPlanEntry {
  agent: string
  action: 'create' | 'update' | 'delete' | 'unchanged'
  /** For an update: the fields that change. */
  changes?: string[]
}

export interface SpecFolderPlanEntry {
  folder: string
  action: 'create' | 'update' | 'delete' | 'unchanged'
  /** For an update: what changes, `owner` and/or `members`. */
  changes?: string[]
}

export interface SpecApplyResult {
  /** The version in force after the apply, or that a dry run would create. */
  version: number
  hash: string
  /** False when the spec resolves to the one already in force. */
  changed: boolean
  plan: SpecPlanEntry[]
  shared_folders: SpecFolderPlanEntry[]
}

export interface AppliedSpec {
  version: number
  hash: string
  applied_at: string
  /** The spec as applied, each prompt reference locked to its version. */
  spec: Record<string, unknown>
}

export interface SpecStatus {
  version: number | null
  agents: Array<{
    agent: string
    template_version: number
    workspaces: number
    /** Workspaces on the agent's latest template version, with its current runtime. */
    up_to_date: number
    /** Workspaces that can't follow the agent or have their shared folders; `listAgents` says why. */
    blocked: number
  }>
}

export interface AgentWorkspace {
  agent: string
  workspace_id: string
  status: string
  template_version: number
  up_to_date: boolean
  /**
   * Why it can't follow its agent (skills the user can't see) or have its
   * shared folders, while it can't.
   */
  blocked: string | null
}

// A token is replaced this long before it expires, so one handed out is never
// about to lapse mid-request.
const RENEW_BEFORE_MS = 60_000

interface CachedToken {
  value: string
  expiresAt: number
}

export class AppClient {
  private readonly baseUrl: string
  private readonly authorization: string
  private readonly fetchImpl: typeof fetch
  private readonly tokens = new Map<string, CachedToken>()
  private readonly pending = new Map<string, Promise<string>>()

  constructor(private readonly options: AppClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.authorization = `Basic ${btoa(`${options.clientId}:${options.clientSecret}`)}`
    this.fetchImpl = options.fetch ?? fetch
  }

  /** `body` goes as JSON, unless it is raw bytes or text with its own content type. */
  private async call(
    method: string,
    path: string,
    body?: unknown,
    contentType?: string,
  ): Promise<Response> {
    const raw = contentType !== undefined
    const res = await this.fetchImpl(`${this.baseUrl}/apps/v1${path}`, {
      method,
      headers: {
        Authorization: this.authorization,
        ...(body === undefined ? {} : { 'Content-Type': contentType ?? 'application/json' }),
      },
      body: body === undefined ? undefined : raw ? (body as BodyInit) : JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new NapError(
        `${method} /apps/v1${path} → ${res.status}: ${text.slice(0, 500)}`,
        res.status,
      )
    }
    return res
  }

  /**
   * Provision the user, or update its name and email. Idempotent: call it
   * whenever the user signs in to your application.
   */
  async upsertUser(
    externalId: string,
    profile: { displayName: string; email?: string | null },
  ): Promise<AppUser> {
    const res = await this.call('PUT', `/users/${encodeURIComponent(externalId)}`, {
      display_name: profile.displayName,
      email: profile.email ?? null,
    })
    return (await res.json()) as AppUser
  }

  /** Delete the user. The platform refuses while the user still owns workspaces. */
  async deleteUser(externalId: string): Promise<void> {
    await this.call('DELETE', `/users/${encodeURIComponent(externalId)}`)
    this.tokens.delete(externalId)
  }

  /** A current access token for the user, reused until shortly before it expires. */
  userToken(externalId: string): Promise<string> {
    const cached = this.tokens.get(externalId)
    if (cached && cached.expiresAt - RENEW_BEFORE_MS > Date.now()) {
      return Promise.resolve(cached.value)
    }
    // Concurrent requests for the same user share one exchange.
    let inFlight = this.pending.get(externalId)
    if (!inFlight) {
      inFlight = this.issueToken(externalId).finally(() => this.pending.delete(externalId))
      this.pending.set(externalId, inFlight)
    }
    return inFlight
  }

  private async issueToken(externalId: string): Promise<string> {
    const res = await this.call('POST', `/users/${encodeURIComponent(externalId)}/token`)
    const { access_token, expires_in } = (await res.json()) as {
      access_token: string
      expires_in: number
    }
    this.tokens.set(externalId, { value: access_token, expiresAt: Date.now() + expires_in * 1000 })
    return access_token
  }

  /** A client acting as the user; its token is renewed as needed. */
  as(externalId: string): NapClient {
    return new NapClient({
      baseUrl: this.options.baseUrl,
      token: () => this.userToken(externalId),
      fetch: this.options.fetch,
    })
  }

  // ── Teams ───────────────────────────────────────────────────────────────

  /**
   * Create a team of your users, or update its name and description.
   * Idempotent. Users share folders with it through `as(externalId)`.
   */
  async upsertTeam(
    externalId: string,
    team: { name: string; description?: string | null },
  ): Promise<AppTeam> {
    const res = await this.call('PUT', `/teams/${encodeURIComponent(externalId)}`, {
      name: team.name,
      description: team.description ?? null,
    })
    return (await res.json()) as AppTeam
  }

  async listTeams(): Promise<(AppTeam & { member_count: number })[]> {
    return (await (await this.call('GET', '/teams')).json()) as (AppTeam & {
      member_count: number
    })[]
  }

  /** Delete the team; folders mounted through it are unmounted. */
  async deleteTeam(externalId: string): Promise<void> {
    await this.call('DELETE', `/teams/${encodeURIComponent(externalId)}`)
  }

  async listTeamMembers(teamExternalId: string): Promise<AppUser[]> {
    const res = await this.call('GET', `/teams/${encodeURIComponent(teamExternalId)}/members`)
    return (await res.json()) as AppUser[]
  }

  /** Add a provisioned user to the team. Idempotent. */
  async addTeamMember(teamExternalId: string, userExternalId: string): Promise<void> {
    await this.call(
      'PUT',
      `/teams/${encodeURIComponent(teamExternalId)}/members/${encodeURIComponent(userExternalId)}`,
    )
  }

  /** Remove the user; the folders they shared with or mounted through the team go too. */
  async removeTeamMember(teamExternalId: string, userExternalId: string): Promise<void> {
    await this.call(
      'DELETE',
      `/teams/${encodeURIComponent(teamExternalId)}/members/${encodeURIComponent(userExternalId)}`,
    )
  }

  // ── Content ─────────────────────────────────────────────────────────────

  /** Publish a prompt. Publishing the same text again keeps its version. */
  async publishPrompt(name: string, content: string): Promise<AppPrompt> {
    const res = await this.call('PUT', `/prompts/${encodeURIComponent(name)}`, { content })
    return (await res.json()) as AppPrompt
  }

  async listPrompts(): Promise<AppPrompt[]> {
    return (await (await this.call('GET', '/prompts')).json()) as AppPrompt[]
  }

  async deletePrompt(name: string): Promise<void> {
    await this.call('DELETE', `/prompts/${encodeURIComponent(name)}`)
  }

  /**
   * Publish a skill: a .tar.gz or .zip with SKILL.md at its root. The bytes
   * decide whether it is a new version, so build the archive reproducibly.
   * The description defaults to the one SKILL.md gives.
   */
  async publishSkill(
    name: string,
    pkg: Uint8Array,
    opts: { description?: string } = {},
  ): Promise<AppSkill> {
    const query = opts.description ? `?description=${encodeURIComponent(opts.description)}` : ''
    const res = await this.call(
      'PUT',
      `/skills/${encodeURIComponent(name)}${query}`,
      pkg,
      'application/octet-stream',
    )
    return (await res.json()) as AppSkill
  }

  async listSkills(): Promise<AppSkill[]> {
    return (await (await this.call('GET', '/skills')).json()) as AppSkill[]
  }

  async deleteSkill(name: string): Promise<void> {
    await this.call('DELETE', `/skills/${encodeURIComponent(name)}`)
  }

  // ── Spec ────────────────────────────────────────────────────────────────

  /**
   * Apply the spec: an object, or YAML text. `dryRun` returns the plan only;
   * a spec that drops agents is refused unless `prune` is given, which
   * deletes them with their users' workspaces. So is one that drops a shared
   * folder or gives it another owner: `prune` revokes each user's copy.
   */
  async applySpec(
    spec: Record<string, unknown> | string,
    opts: { dryRun?: boolean; prune?: boolean } = {},
  ): Promise<SpecApplyResult> {
    const params = new URLSearchParams()
    if (opts.dryRun) params.set('dry_run', 'true')
    if (opts.prune) params.set('prune', 'true')
    const path = `/spec${params.size > 0 ? `?${params}` : ''}`
    const res =
      typeof spec === 'string'
        ? await this.call('PUT', path, spec, 'application/yaml')
        : await this.call('PUT', path, spec)
    return (await res.json()) as SpecApplyResult
  }

  /** The spec in force, or null before the first apply. */
  async getSpec(): Promise<AppliedSpec | null> {
    try {
      return (await (await this.call('GET', '/spec')).json()) as AppliedSpec
    } catch (err) {
      if (err instanceof NapError && err.status === 404) return null
      throw err
    }
  }

  /** How far the users' workspaces have followed the spec. */
  async specStatus(): Promise<SpecStatus> {
    return (await (await this.call('GET', '/spec/status')).json()) as SpecStatus
  }

  // ── Agents ──────────────────────────────────────────────────────────────

  /**
   * The user's workspace for an agent of the spec, created on the first call.
   * Chat with it through `as(externalId)`.
   */
  async ensureAgent(externalId: string, agent: string): Promise<AgentWorkspace> {
    const res = await this.call(
      'PUT',
      `/users/${encodeURIComponent(externalId)}/agents/${encodeURIComponent(agent)}`,
    )
    return (await res.json()) as AgentWorkspace
  }

  async listAgents(externalId: string): Promise<AgentWorkspace[]> {
    const res = await this.call('GET', `/users/${encodeURIComponent(externalId)}/agents`)
    return (await res.json()) as AgentWorkspace[]
  }

  async deleteAgent(externalId: string, agent: string): Promise<void> {
    await this.call(
      'DELETE',
      `/users/${encodeURIComponent(externalId)}/agents/${encodeURIComponent(agent)}`,
    )
  }
}
