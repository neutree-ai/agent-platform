import { i18n } from '@/lib/i18n'
import type {
  AdminAgentType,
  AdminCluster,
  AdminMcpUsage,
  AdminPowerAgent,
  AdminPowerUser,
  AdminSessionSource,
  AdminSkillUsage,
  AdminTokenUsage,
  AdminTotals,
  AdminTrend,
  AdminUser,
  AgentInfo,
  ApiActivitySummary,
  ApiAgentRequest,
  ApiApplication,
  ApiApplicationSecret,
  ApiCredentialMeta,
  ApiMemory,
  ApiMemoryLite,
  ApiMemoryStore,
  ApiMemoryStoreAttachment,
  ApiMemoryVersion,
  ApiMemoryVersionDetail,
  ApiMessage,
  ApiModelProvider,
  ApiPrompt,
  ApiPromptGrant,
  ApiPromptVersion,
  ApiProviderGrant,
  ApiRecentSessionItem,
  ApiServiceToken,
  ApiShare,
  ApiShareData,
  ApiSkill,
  ApiSkillGrant,
  ApiSkillSource,
  ApiSkillVersion,
  ApiTeam,
  ApiTeamInvite,
  ApiTeamInvitePreview,
  ApiTeamMember,
  ApiTeamworkParticipant,
  ApiTeamworkRosterCandidate,
  ApiTeamworkSession,
  ApiTeamworkTask,
  ApiTemplate,
  ApiTemplateGrant,
  ApiTemplateVersion,
  ApiUsageSummary,
  ApiWorkspaceConfig,
  ApiWorkspaceLayout,
  ApiWorkspaceMemoryAttachment,
  AskUserRequest,
  BrowserListResponse,
  BrowserSession,
  CallableAgent,
  ComputeResources,
  K8sResourceStatus,
  LayoutSkeleton,
  McpCatalogEntry,
  WorkspacePluginEntry,
  MemoryAccess,
  PendingMessage,
  PromptGrant,
  PromptVisibility,
  ProviderGrant,
  ProviderVisibility,
  SandboxInfo,
  SandboxListResponse,
  Schedule,
  Session,
  SkillDependents,
  SkillGrant,
  SkillSourceKind,
  SkillVisibility,
  Tag,
  TeamRole,
  TeamworkSessionRole,
  TemplateGrant,
  TemplateVisibility,
  User,
  UserProfilePayload,
  Workspace,
  WorkspaceCommand,
  WorkspaceProfilePayload,
} from './types'

/**
 * Error subclass that preserves the parsed JSON body of a 4xx/5xx response,
 * so callers can read structured fields (e.g. template link-acl `missing[]`)
 * instead of having to string-parse the English message.
 */
export class ApiClientError extends Error {
  readonly status: number
  readonly body: Record<string, unknown>

  constructor(message: string, status: number, body: Record<string, unknown>) {
    super(message)
    this.name = 'ApiClientError'
    this.status = status
    this.body = body
  }
}

class ApiClient {
  private baseUrl = '/api'

  private async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const url =
      endpoint.startsWith('/_cp/') || endpoint.startsWith('/_saas/')
        ? endpoint
        : `${this.baseUrl}${endpoint}`
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      credentials: 'include',
    })

    if (!response.ok) {
      if (
        response.status === 401 &&
        !endpoint.includes('/auth/') &&
        window.location.pathname !== '/login'
      ) {
        window.location.href = '/login'
        throw new Error(i18n.t('common.errors.sessionExpired'))
      }
      const body: Record<string, unknown> = await response
        .json()
        .catch(() => ({ error: i18n.t('common.errors.requestFailed') }))
      const message =
        (typeof body.error === 'string' && body.error) || i18n.t('common.errors.requestFailed')
      throw new ApiClientError(message, response.status, body)
    }

    // 204 No Content (and any other empty success body) has no JSON to
    // parse — calling .json() on it throws "Unexpected end of JSON input".
    // request<void>() callers (DELETE endpoints, discard draft, etc) rely
    // on this returning undefined cleanly.
    if (response.status === 204 || response.headers.get('Content-Length') === '0') {
      return undefined as T
    }
    return response.json()
  }

  // Build version (public, unauthenticated)
  async getVersion(): Promise<{ commit: string; builtAt: string | null }> {
    return this.request<{ commit: string; builtAt: string | null }>('/version')
  }

  // Auth
  async getMe(): Promise<User> {
    return this.request<User>('/auth/me')
  }

  async login(username: string, password: string): Promise<User> {
    return this.request<User>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
  }

  async logout(): Promise<void> {
    await this.request<{ success: boolean }>('/auth/logout', {
      method: 'POST',
    })
  }

  async setDefaultPrompt(promptId: string | null): Promise<void> {
    await this.request('/auth/me/default-prompt', {
      method: 'PUT',
      body: JSON.stringify({ prompt_id: promptId }),
    })
  }

  async patchMe(patch: { auto_evolution?: boolean }): Promise<void> {
    await this.request('/auth/me', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
  }

  async changeMyPassword(currentPassword: string, newPassword: string): Promise<void> {
    await this.request('/auth/me/password', {
      method: 'PUT',
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    })
  }

  // Workspaces
  async getWorkspaces(opts?: { search?: string }): Promise<Workspace[]> {
    const params = new URLSearchParams()
    if (opts?.search) params.set('search', opts.search)
    const qs = params.toString()
    return this.request<Workspace[]>(`/workspaces${qs ? `?${qs}` : ''}`)
  }

  async getCallableAgents(): Promise<CallableAgent[]> {
    return this.request<CallableAgent[]>('/workspaces/callable')
  }

  async createWorkspace(data: {
    name: string
    is_system?: boolean
    template_id?: string
    agent_type?: string
    compute_resources?: ComputeResources
    provider_id?: string
    provider_type?: string
    base_url?: string
    api_key?: string
    model?: string
    small_model?: string
    prompt_id?: string
    system_prompt?: string
    mcp_config?: string
    agent_settings?: string
    /**
     * p3: server now keys workspace skills by UUID. Pass `skill_ids`; the
     * legacy `skill_names` field is kept on the wire for back-compat but the
     * web client no longer sends it.
     */
    skill_ids?: string[]
    /** Recipient consent for template-provided schedules (name → enabled). */
    schedule_overrides?: Record<string, boolean>
  }): Promise<Workspace> {
    return this.request<Workspace>('/workspaces', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async renameWorkspace(id: string, name: string): Promise<Workspace> {
    return this.request<Workspace>(`/workspaces/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    })
  }

  async patchWorkspace(
    id: string,
    patch: { name?: string; slug?: string | null; visibility?: string },
  ): Promise<Workspace> {
    return this.request<Workspace>(`/workspaces/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
  }

  async startWorkspace(id: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/workspaces/${id}/start`, {
      method: 'POST',
    })
  }

  async markSessionsSeen(id: string, sessionId?: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/workspaces/${id}/seen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sessionId ? { sessionId } : {}),
    })
  }

  async stopWorkspace(id: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/workspaces/${id}/stop`, {
      method: 'POST',
    })
  }

  async deleteWorkspace(id: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/workspaces/${id}`, {
      method: 'DELETE',
    })
  }

  async getWorkspaceStatus(id: string): Promise<K8sResourceStatus> {
    return this.request<K8sResourceStatus>(`/workspaces/${id}/status`)
  }

  async rebuildWorkspace(id: string): Promise<{ rebuilt: boolean; reason?: string }> {
    return this.request<{ rebuilt: boolean; reason?: string }>(`/workspaces/${id}/rebuild`, {
      method: 'POST',
    })
  }

  async getWorkspaceMessages(id: string, sessionId?: string): Promise<ApiMessage[]> {
    const params = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ''
    return this.request<ApiMessage[]>(`/workspaces/${id}/messages${params}`)
  }

  async deleteWorkspaceMessages(id: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/workspaces/${id}/messages`, {
      method: 'DELETE',
    })
  }

  // System Workspaces
  async getSystemWsSessions(wsId: string): Promise<Session[]> {
    return this.request<Session[]>(`/system-workspaces/${wsId}/sessions`)
  }

  async getSystemWsMessages(wsId: string, sessionId: string): Promise<ApiMessage[]> {
    return this.request<ApiMessage[]>(
      `/system-workspaces/${wsId}/sessions/${encodeURIComponent(sessionId)}/messages`,
    )
  }

  // Sessions
  async getSessions(
    workspaceId: string,
    opts?: { limit?: number; offset?: number; starred?: boolean },
  ): Promise<{ items: Session[]; total: number }> {
    const params = new URLSearchParams()
    if (opts?.limit != null) params.set('limit', String(opts.limit))
    if (opts?.offset != null) params.set('offset', String(opts.offset))
    if (opts?.starred) params.set('starred', 'true')
    const qs = params.toString()
    return this.request(`/workspaces/${workspaceId}/sessions${qs ? `?${qs}` : ''}`)
  }

  async getSession(
    workspaceId: string,
    sessionId: string,
  ): Promise<{
    id: string
    name: string
    chat_status: string
    status: string
    preview: string
    pending_message: PendingMessage | null
  }> {
    return this.request(`/workspaces/${workspaceId}/sessions/${sessionId}`)
  }

  /** Set (replace) the session's queued follow-up draft. */
  async setPendingMessage(
    workspaceId: string,
    sessionId: string,
    msg: PendingMessage,
  ): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(
      `/workspaces/${workspaceId}/sessions/${encodeURIComponent(sessionId)}/pending`,
      { method: 'PUT', body: JSON.stringify(msg) },
    )
  }

  /** Drop the session's queued follow-up draft. */
  async clearPendingMessage(workspaceId: string, sessionId: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(
      `/workspaces/${workspaceId}/sessions/${encodeURIComponent(sessionId)}/pending`,
      { method: 'DELETE' },
    )
  }

  async renameSession(
    workspaceId: string,
    sessionId: string,
    name: string,
  ): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(
      `/workspaces/${workspaceId}/sessions/${encodeURIComponent(sessionId)}`,
      { method: 'PATCH', body: JSON.stringify({ name }) },
    )
  }

  /** Star or un-star a session. */
  async setSessionStarred(
    workspaceId: string,
    sessionId: string,
    starred: boolean,
  ): Promise<{ success: boolean; starred: boolean }> {
    return this.request<{ success: boolean; starred: boolean }>(
      `/workspaces/${workspaceId}/sessions/${encodeURIComponent(sessionId)}/star`,
      { method: 'POST', body: JSON.stringify({ starred }) },
    )
  }

  async interruptSession(
    workspaceId: string,
    sessionId: string,
  ): Promise<{ success: boolean; interrupted?: boolean }> {
    return this.request<{ success: boolean; interrupted?: boolean }>(
      `/workspaces/${workspaceId}/sessions/${encodeURIComponent(sessionId)}/interrupt`,
      { method: 'POST' },
    )
  }

  async deleteSession(workspaceId: string, sessionId: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(
      `/workspaces/${workspaceId}/sessions/${encodeURIComponent(sessionId)}`,
      { method: 'DELETE' },
    )
  }

  async respondToQuestion(
    workspaceId: string,
    sessionId: string,
    requestId: string,
    answers: Record<string, string>,
  ): Promise<{ success: boolean }> {
    const url = `/_proxy/agent/${workspaceId}/sessions/${encodeURIComponent(sessionId)}/respond`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId, answers }),
      credentials: 'include',
    })
    if (!response.ok) {
      throw new Error(i18n.t('session.errors.respondQuestionFailed'))
    }
    return response.json()
  }

  async getPendingQuestion(workspaceId: string, sessionId: string): Promise<AskUserRequest | null> {
    const url = `/_proxy/agent/${workspaceId}/sessions/${encodeURIComponent(sessionId)}/pending-question`
    const response = await fetch(url, { credentials: 'include' })
    if (!response.ok) return null
    return (await response.json()) ?? null
  }

  // ── Memory stores (P1: user-level, agent doesn't read yet) ────────────────

  async listMemoryStores(opts?: { includeArchived?: boolean }): Promise<ApiMemoryStore[]> {
    const q = opts?.includeArchived ? '?include_archived=true' : ''
    const res = await this.request<{ stores: ApiMemoryStore[] }>(`/memory-stores${q}`)
    return res.stores ?? []
  }

  async getMemoryStore(id: string): Promise<ApiMemoryStore> {
    return this.request<ApiMemoryStore>(`/memory-stores/${id}`)
  }

  async createMemoryStore(body: {
    name: string
    description?: string
  }): Promise<ApiMemoryStore> {
    return this.request<ApiMemoryStore>('/memory-stores', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  async patchMemoryStore(
    id: string,
    patch: {
      name?: string
      description?: string
      archived?: boolean
    },
  ): Promise<ApiMemoryStore> {
    return this.request<ApiMemoryStore>(`/memory-stores/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
  }

  async deleteMemoryStore(id: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/memory-stores/${id}`, { method: 'DELETE' })
  }

  async listMemoriesInStore(storeId: string): Promise<ApiMemoryLite[]> {
    const res = await this.request<{ memories: ApiMemoryLite[] }>(
      `/memory-stores/${storeId}/memories`,
    )
    return res.memories ?? []
  }

  // path is leading-slash, e.g. "/user/profile.md"
  async getMemory(storeId: string, path: string): Promise<ApiMemory> {
    return this.request<ApiMemory>(`/memory-stores/${storeId}/memory${path}`)
  }

  async putMemory(
    storeId: string,
    path: string,
    body: { content: string; description?: string; mem_type?: string; if_match_sha256?: string },
  ): Promise<ApiMemory> {
    return this.request<ApiMemory>(`/memory-stores/${storeId}/memory${path}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    })
  }

  async deleteMemory(
    storeId: string,
    path: string,
    body?: { if_match_sha256?: string },
  ): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/memory-stores/${storeId}/memory${path}`, {
      method: 'DELETE',
      body: JSON.stringify(body ?? {}),
    })
  }

  async listMemoryVersions(
    storeId: string,
    opts?: { path?: string; limit?: number },
  ): Promise<ApiMemoryVersion[]> {
    const q = new URLSearchParams()
    if (opts?.path) q.set('path', opts.path)
    if (opts?.limit) q.set('limit', String(opts.limit))
    const qs = q.toString()
    const res = await this.request<{ versions: ApiMemoryVersion[] }>(
      `/memory-stores/${storeId}/versions${qs ? `?${qs}` : ''}`,
    )
    return res.versions ?? []
  }

  async getMemoryVersion(storeId: string, versionId: string): Promise<ApiMemoryVersionDetail> {
    return this.request<ApiMemoryVersionDetail>(
      `/memory-stores/${storeId}/memory-versions/${versionId}`,
    )
  }

  async rollbackMemory(storeId: string, versionId: string): Promise<ApiMemory> {
    return this.request<ApiMemory>(`/memory-stores/${storeId}/rollback`, {
      method: 'POST',
      body: JSON.stringify({ version_id: versionId }),
    })
  }

  // ── Workspace ↔ memory store attachments ──────────────────────────────────

  async listMemoryStoreAttachments(storeId: string): Promise<ApiMemoryStoreAttachment[]> {
    const res = await this.request<{ attachments: ApiMemoryStoreAttachment[] }>(
      `/memory-stores/${storeId}/attachments`,
    )
    return res.attachments ?? []
  }

  async listWorkspaceMemoryAttachments(
    workspaceId: string,
  ): Promise<ApiWorkspaceMemoryAttachment[]> {
    const res = await this.request<{ attachments: ApiWorkspaceMemoryAttachment[] }>(
      `/workspaces/${workspaceId}/memory-attachments`,
    )
    return res.attachments ?? []
  }

  async attachMemoryStore(
    workspaceId: string,
    body: { store_id: string; access?: MemoryAccess; instructions?: string },
  ): Promise<ApiWorkspaceMemoryAttachment> {
    return this.request<ApiWorkspaceMemoryAttachment>(
      `/workspaces/${workspaceId}/memory-attachments`,
      { method: 'POST', body: JSON.stringify(body) },
    )
  }

  async patchMemoryAttachment(
    workspaceId: string,
    storeId: string,
    patch: { access?: MemoryAccess; instructions?: string },
  ): Promise<ApiWorkspaceMemoryAttachment> {
    return this.request<ApiWorkspaceMemoryAttachment>(
      `/workspaces/${workspaceId}/memory-attachments/${storeId}`,
      { method: 'PATCH', body: JSON.stringify(patch) },
    )
  }

  async detachMemoryStore(workspaceId: string, storeId: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(
      `/workspaces/${workspaceId}/memory-attachments/${storeId}`,
      { method: 'DELETE' },
    )
  }

  // Workspace profile (UI prefs — opaque payload, server merges)
  async getWorkspaceProfile(id: string): Promise<WorkspaceProfilePayload> {
    const res = await this.request<{ payload: WorkspaceProfilePayload }>(
      `/workspaces/${id}/profile`,
    )
    return res.payload ?? {}
  }

  async patchWorkspaceProfile(
    id: string,
    patch: WorkspaceProfilePayload,
  ): Promise<WorkspaceProfilePayload> {
    const res = await this.request<{ payload: WorkspaceProfilePayload }>(
      `/workspaces/${id}/profile`,
      {
        method: 'PATCH',
        body: JSON.stringify(patch),
      },
    )
    return res.payload ?? {}
  }

  // User profile (fleet / global UI prefs — same opaque-payload semantics as the workspace profile)
  async getUserProfile(): Promise<UserProfilePayload> {
    const res = await this.request<{ payload: UserProfilePayload }>('/me/profile')
    return res.payload ?? {}
  }

  async patchUserProfile(patch: UserProfilePayload): Promise<UserProfilePayload> {
    const res = await this.request<{ payload: UserProfilePayload }>('/me/profile', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
    return res.payload ?? {}
  }

  async getRecentSessions(limit = 12): Promise<ApiRecentSessionItem[]> {
    const res = await this.request<{ items: ApiRecentSessionItem[] }>(
      `/me/recent-sessions?limit=${limit}`,
    )
    return res.items ?? []
  }

  async getActivitySummary(days = 30): Promise<ApiActivitySummary> {
    return this.request<ApiActivitySummary>(`/me/activity-summary?days=${days}`)
  }

  async getUsageSummary(days = 30): Promise<ApiUsageSummary> {
    return this.request<ApiUsageSummary>(`/me/usage-summary?days=${days}`)
  }

  // Workspace config
  async getWorkspaceConfig(id: string): Promise<ApiWorkspaceConfig> {
    return this.request<ApiWorkspaceConfig>(`/workspaces/${id}/config`)
  }

  async updateWorkspaceConfig(
    id: string,
    config: Partial<ApiWorkspaceConfig>,
  ): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/workspaces/${id}/config`, {
      method: 'PUT',
      body: JSON.stringify(config),
    })
  }

  async resolveBuilderPatch(
    workspaceId: string,
    body: {
      source_event_id: string
      session_id: string
      action: 'apply' | 'reject'
      kind: 'workspace.prompt.set'
      payload: { content: string }
    },
  ): Promise<{
    applied: boolean
    status: 'applied' | 'rejected' | 'stale'
    new_version: string | null
  }> {
    return this.request(`/workspaces/${workspaceId}/builder/resolve`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  // Skills
  /**
   * p3: skills are keyed by UUID. URLs use `:id`; `name` is display-only.
   *
   * Optional `filters`:
   *   - `q`     case-insensitive substring across name + description
   *   - `owner` exact-match on the skill's user_id
   * Backend AND-composes them and applies after the visibility join, so
   * filters only narrow what the caller could already see.
   */
  async listSkills(filters?: {
    q?: string
    owner?: string
    /**
     * OR-composed list of categories. Include the literal `"uncategorized"`
     * to also match skills with no category set.
     */
    categories?: string[]
    visibility?: SkillVisibility
  }): Promise<ApiSkill[]> {
    const params = new URLSearchParams()
    if (filters?.q) params.set('q', filters.q)
    if (filters?.owner) params.set('owner', filters.owner)
    if (filters?.categories && filters.categories.length > 0) {
      params.set('category', filters.categories.join(','))
    }
    if (filters?.visibility) params.set('visibility', filters.visibility)
    const qs = params.toString()
    return this.request<ApiSkill[]>(qs ? `/skills?${qs}` : '/skills')
  }

  async getSkill(id: string): Promise<ApiSkill> {
    return this.request<ApiSkill>(`/skills/${encodeURIComponent(id)}`)
  }

  /**
   * One-shot tarball upload. The cp endpoint creates an implicit native
   * source + skill + initial version in one call. For native source
   * authoring (where you want a draft cycle) use `createNativeSource` +
   * `saveSkillDraft` + `publishSkill` instead.
   */
  async uploadSkill(
    name: string,
    description: string,
    file: ArrayBuffer,
    visibility: SkillVisibility = 'private',
  ): Promise<ApiSkill> {
    const params = new URLSearchParams({ name, description, visibility })
    return this.request<ApiSkill>(`/skills?${params}`, {
      method: 'POST',
      body: file,
      headers: { 'Content-Type': 'application/gzip' },
    })
  }

  async updateSkillMeta(
    id: string,
    updates: {
      name?: string
      description?: string
      visibility?: SkillVisibility
      grants?: SkillGrant[]
      /** `null` clears the category; `undefined` leaves it unchanged. */
      category?: string | null
    },
  ): Promise<ApiSkill> {
    return this.request<ApiSkill>(`/skills/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    })
  }

  async listSkillGrants(id: string): Promise<ApiSkillGrant[]> {
    return this.request<ApiSkillGrant[]>(`/skills/${encodeURIComponent(id)}/grants`)
  }

  async setSkillGrants(id: string, grants: SkillGrant[]): Promise<ApiSkillGrant[]> {
    return this.request<ApiSkillGrant[]>(`/skills/${encodeURIComponent(id)}/grants`, {
      method: 'PUT',
      body: JSON.stringify({ grants }),
    })
  }

  async deleteSkill(id: string): Promise<void> {
    await this.request<void>(`/skills/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  /**
   * Owner-only occupancy preview: which workspaces / template versions still
   * use this skill. Own workspaces are named; other users' workspaces come
   * back as a count only (cross-user privacy).
   */
  async getSkillDependents(id: string): Promise<SkillDependents> {
    return this.request<SkillDependents>(`/skills/${encodeURIComponent(id)}/dependents`)
  }

  /**
   * Import a single subpath from a git repo. After p3 `subpath` is the
   * authoritative selector and is REQUIRED (server-side `z.string()`) — get
   * it by running `scanSkillRepo` first and passing `candidates[i].subpath`
   * (use `''` for a repo-root skill). Omitting it makes the server reject the
   * request, so callers must always resolve a concrete value.
   */
  async importSkillFromGit(data: {
    url: string
    type?: string
    token?: string
    credential_name?: string
    name?: string
    description?: string
    visibility?: SkillVisibility
    grants?: SkillGrant[]
    subpath: string
    ref?: string
  }): Promise<ApiSkill> {
    return this.request<ApiSkill>('/skills/from-git', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  /**
   * Switch an existing native skill to a git source in place. The skill keeps
   * its UUID — so every mount survives — but its native version history is
   * WIPED (only the freshly fetched git version remains). Destructive: the
   * caller must confirm history loss with the user first. `subpath` is the
   * required selector, same as `importSkillFromGit`.
   */
  async switchSkillToGit(
    id: string,
    data: {
      url: string
      type?: string
      ref?: string
      token?: string
      credential_name?: string
      subpath: string
    },
  ): Promise<ApiSkill> {
    return this.request<ApiSkill>(`/skills/${encodeURIComponent(id)}/switch-to-git`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  /**
   * Scan a user-uploaded tarball for skill candidates without writing the
   * DB. Mirrors `scanSkillRepo`'s candidate shape (minus requestedSubpath,
   * which only makes sense for git URLs).
   */
  async scanSkillTarball(file: ArrayBuffer): Promise<{
    candidates: Array<{
      subpath: string
      name: string | null
      description: string | null
      fileCount: number
      files: Array<{ path: string; size: number }>
      skillMd: string | null
    }>
  }> {
    return this.request('/skills/scan-tarball', {
      method: 'POST',
      body: file,
      headers: { 'Content-Type': 'application/gzip' },
    })
  }

  /**
   * Scan a git repo for skill candidates without writing the DB. Used by the
   * import dialog to render a picker before committing — the response carries
   * one entry per `SKILL.md` found in the repo.
   */
  async scanSkillRepo(data: {
    url: string
    type?: string
    ref?: string
    token?: string
    credential_name?: string
  }): Promise<{
    candidates: Array<{
      subpath: string
      name: string | null
      description: string | null
      fileCount: number
      files: Array<{ path: string; size: number }>
      skillMd: string | null
    }>
    /** Parsed from the input URL — null when the URL didn't carry one. */
    requested_subpath: string | null
    commit_sha: string | null
  }> {
    return this.request('/skills/scan-git', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  // ── Sources (p3) ────────────────────────────────────────────────────────

  async listSkillSources(kind?: SkillSourceKind): Promise<ApiSkillSource[]> {
    const qs = kind ? `?kind=${encodeURIComponent(kind)}` : ''
    return this.request<ApiSkillSource[]>(`/skills/sources${qs}`)
  }

  async getSkillSource(id: string): Promise<ApiSkillSource> {
    return this.request<ApiSkillSource>(`/skills/sources/${encodeURIComponent(id)}`)
  }

  async listSourceSkills(sourceId: string): Promise<ApiSkill[]> {
    return this.request<ApiSkill[]>(`/skills/sources/${encodeURIComponent(sourceId)}/skills`)
  }

  async createNativeSource(data: {
    name: string
    description: string
    visibility: SkillVisibility
    category?: string | null
  }): Promise<{ source: ApiSkillSource; skill: ApiSkill }> {
    return this.request<{ source: ApiSkillSource; skill: ApiSkill }>('/skills/sources/native', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateSkillSource(
    id: string,
    patch: { credential_name?: string | null; git_ref?: string },
  ): Promise<ApiSkillSource> {
    return this.request<ApiSkillSource>(`/skills/sources/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
  }

  async deleteSkillSource(id: string): Promise<void> {
    await this.request<void>(`/skills/sources/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  /**
   * Re-fetch all skills under a git source. p3 collapses per-skill sync into
   * a single source-level operation; the response carries per-skill diff
   * flags so callers can show a "what changed" summary.
   */
  async syncSkillSource(
    sourceId: string,
    opts?: { token?: string; credentialName?: string },
  ): Promise<{
    source: ApiSkillSource
    results: Array<{
      skill_id: string
      version_id: string
      content_hash: string
      changed: boolean
    }>
    commit_sha: string | null
  }> {
    return this.request(`/skills/sources/${encodeURIComponent(sourceId)}/sync`, {
      method: 'POST',
      body: JSON.stringify({
        token: opts?.token,
        credential_name: opts?.credentialName,
      }),
    })
  }

  async saveSkillDraft(
    sourceId: string,
    body: ArrayBuffer,
  ): Promise<{ ok: true; byte_count: number }> {
    return this.request<{ ok: true; byte_count: number }>(
      `/skills/sources/${encodeURIComponent(sourceId)}/draft`,
      {
        method: 'PUT',
        body,
        headers: { 'Content-Type': 'application/gzip' },
      },
    )
  }

  async discardSkillDraft(sourceId: string): Promise<void> {
    await this.request<void>(`/skills/sources/${encodeURIComponent(sourceId)}/draft`, {
      method: 'DELETE',
    })
  }

  // ── Library editor: per-file draft CRUD ─────────────────────────────────

  async listDraftFiles(
    sourceId: string,
  ): Promise<Array<{ path: string; type: 'file' | 'dir'; size?: number }>> {
    const data = await this.request<{
      entries: Array<{ path: string; type: 'file' | 'dir'; size?: number }>
    }>(`/skills/sources/${encodeURIComponent(sourceId)}/draft/files`)
    return data.entries
  }

  draftFileUrl(sourceId: string, path: string): string {
    return `${this.baseUrl}/skills/sources/${encodeURIComponent(sourceId)}/draft/file?path=${encodeURIComponent(path)}`
  }

  async readDraftFile(sourceId: string, path: string): Promise<ArrayBuffer> {
    const resp = await fetch(this.draftFileUrl(sourceId, path), { credentials: 'include' })
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}))
      throw new Error((err as any).error || `Read draft file failed: ${resp.status}`)
    }
    return resp.arrayBuffer()
  }

  async writeDraftFile(
    sourceId: string,
    path: string,
    body: ArrayBuffer | Uint8Array,
  ): Promise<{ ok: true; byte_count: number }> {
    return this.request<{ ok: true; byte_count: number }>(
      `/skills/sources/${encodeURIComponent(sourceId)}/draft/file?path=${encodeURIComponent(path)}`,
      {
        method: 'PUT',
        body: body as BodyInit,
        headers: { 'Content-Type': 'application/octet-stream' },
      },
    )
  }

  async deleteDraftFile(sourceId: string, path: string): Promise<void> {
    await this.request<void>(
      `/skills/sources/${encodeURIComponent(sourceId)}/draft/file?path=${encodeURIComponent(path)}`,
      { method: 'DELETE' },
    )
  }

  // ── Versions (p3) ───────────────────────────────────────────────────────

  async listSkillVersions(skillId: string): Promise<ApiSkillVersion[]> {
    return this.request<ApiSkillVersion[]>(`/skills/${encodeURIComponent(skillId)}/versions`)
  }

  /**
   * Publish the active draft of a native source as a new version (and set it
   * active). Returns the updated skill plus the newly created version row.
   */
  async publishSkill(
    skillId: string,
    note?: string,
  ): Promise<{ skill: ApiSkill; version: ApiSkillVersion }> {
    return this.request<{ skill: ApiSkill; version: ApiSkillVersion }>(
      `/skills/${encodeURIComponent(skillId)}/publish`,
      {
        method: 'POST',
        body: JSON.stringify(note != null ? { note } : {}),
      },
    )
  }

  async setSkillActiveVersion(skillId: string, versionId: string): Promise<ApiSkill> {
    return this.request<ApiSkill>(`/skills/${encodeURIComponent(skillId)}/active-version`, {
      method: 'PUT',
      body: JSON.stringify({ version_id: versionId }),
    })
  }

  /**
   * Workspace-bound skill list. p3 cp returns `{id, name, editable, gitSource}`
   * per skill (id is the UUID; name kept for display until callers migrate).
   * We surface ids to the rest of the app — name lookup goes through
   * `listSkills` when needed.
   */
  async getWorkspaceSkillIds(id: string): Promise<string[]> {
    const data = await this.request<{
      skills: Array<{ id: string; name: string; editable: boolean; gitSource: boolean }>
    }>(`/_cp/workspaces/${id}/skills`)
    return data.skills.map((s) => s.id)
  }

  async updateWorkspaceSkills(id: string, skillIds: string[]): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/_cp/workspaces/${id}/skills`, {
      method: 'PUT',
      body: JSON.stringify({ skills: skillIds }),
    })
  }

  // Teams
  async listTeams(): Promise<ApiTeam[]> {
    return this.request<ApiTeam[]>('/teams')
  }

  async createTeam(data: { name: string; description?: string }): Promise<ApiTeam> {
    return this.request<ApiTeam>('/teams', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async getTeam(id: string): Promise<ApiTeam> {
    return this.request<ApiTeam>(`/teams/${encodeURIComponent(id)}`)
  }

  async updateTeam(
    id: string,
    data: Partial<{ name: string; description: string | null }>,
  ): Promise<ApiTeam> {
    return this.request<ApiTeam>(`/teams/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  }

  async deleteTeam(id: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/teams/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  }

  async listTeamMembers(id: string): Promise<ApiTeamMember[]> {
    return this.request<ApiTeamMember[]>(`/teams/${encodeURIComponent(id)}/members`)
  }

  async addTeamMember(
    teamId: string,
    data: { user_id: string; role?: TeamRole },
  ): Promise<ApiTeamMember> {
    return this.request<ApiTeamMember>(`/teams/${encodeURIComponent(teamId)}/members`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateTeamMember(
    teamId: string,
    userId: string,
    role: TeamRole,
  ): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(
      `/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`,
      { method: 'PATCH', body: JSON.stringify({ role }) },
    )
  }

  async removeTeamMember(teamId: string, userId: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(
      `/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`,
      { method: 'DELETE' },
    )
  }

  async listTeamInvites(teamId: string): Promise<ApiTeamInvite[]> {
    return this.request<ApiTeamInvite[]>(`/teams/${encodeURIComponent(teamId)}/invites`)
  }

  async createTeamInvite(
    teamId: string,
    data: { expires_in_days?: number } = {},
  ): Promise<ApiTeamInvite> {
    return this.request<ApiTeamInvite>(`/teams/${encodeURIComponent(teamId)}/invites`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async deleteTeamInvite(teamId: string, token: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(
      `/teams/${encodeURIComponent(teamId)}/invites/${encodeURIComponent(token)}`,
      { method: 'DELETE' },
    )
  }

  // Teamwork
  async listTeamworkTasks(): Promise<ApiTeamworkTask[]> {
    return this.request<ApiTeamworkTask[]>('/teamwork')
  }

  async listTeamworkRosterCandidates(): Promise<ApiTeamworkRosterCandidate[]> {
    return this.request<ApiTeamworkRosterCandidate[]>('/teamwork/roster-candidates')
  }

  async createTeamworkTask(data: {
    name: string
    brief?: string
    coordinator_workspace_id: string
  }): Promise<ApiTeamworkTask> {
    return this.request<ApiTeamworkTask>('/teamwork', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async getTeamworkTask(id: string): Promise<ApiTeamworkTask> {
    return this.request<ApiTeamworkTask>(`/teamwork/${encodeURIComponent(id)}`)
  }

  async updateTeamworkTask(
    id: string,
    data: Partial<{ name: string; brief: string | null }>,
  ): Promise<ApiTeamworkTask> {
    return this.request<ApiTeamworkTask>(`/teamwork/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  }

  async deleteTeamworkTask(id: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/teamwork/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  }

  async listTeamworkParticipants(taskId: string): Promise<ApiTeamworkParticipant[]> {
    return this.request<ApiTeamworkParticipant[]>(
      `/teamwork/${encodeURIComponent(taskId)}/participants`,
    )
  }

  async addTeamworkParticipant(
    taskId: string,
    workspaceId: string,
  ): Promise<ApiTeamworkParticipant> {
    return this.request<ApiTeamworkParticipant>(
      `/teamwork/${encodeURIComponent(taskId)}/participants`,
      { method: 'POST', body: JSON.stringify({ workspace_id: workspaceId }) },
    )
  }

  async removeTeamworkParticipant(
    taskId: string,
    workspaceId: string,
  ): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(
      `/teamwork/${encodeURIComponent(taskId)}/participants/${encodeURIComponent(workspaceId)}`,
      { method: 'DELETE' },
    )
  }

  async listTeamworkSessions(taskId: string): Promise<ApiTeamworkSession[]> {
    return this.request<ApiTeamworkSession[]>(`/teamwork/${encodeURIComponent(taskId)}/sessions`)
  }

  async registerTeamworkSession(
    taskId: string,
    data: {
      session_id: string
      role?: TeamworkSessionRole
      parent_session_id?: string | null
    },
  ): Promise<ApiTeamworkSession> {
    return this.request<ApiTeamworkSession>(`/teamwork/${encodeURIComponent(taskId)}/sessions`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  // Invites (accept / preview by anyone with the link)
  async previewInvite(token: string): Promise<ApiTeamInvitePreview> {
    return this.request<ApiTeamInvitePreview>(`/invites/${encodeURIComponent(token)}`)
  }

  async acceptInvite(token: string): Promise<{ team_id: string; already_member: boolean }> {
    return this.request<{ team_id: string; already_member: boolean }>(
      `/invites/${encodeURIComponent(token)}/accept`,
      { method: 'POST' },
    )
  }

  // Credentials
  async listCredentials(): Promise<ApiCredentialMeta[]> {
    return this.request<ApiCredentialMeta[]>('/credentials')
  }

  async upsertCredential(
    name: string,
    data: {
      value: string
      inject: string
      path?: string
      mode?: string
      scope?: 'global' | 'selected'
      workspace_ids?: string[]
    },
  ): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/credentials/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async deleteCredential(name: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/credentials/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    })
  }

  // Providers
  async listProviders(): Promise<ApiModelProvider[]> {
    return this.request<ApiModelProvider[]>('/providers')
  }

  async createProvider(data: {
    name: string
    description?: string
    provider_type: string
    base_url: string
    api_key: string
    visibility?: ProviderVisibility
    grants?: ProviderGrant[]
  }): Promise<ApiModelProvider> {
    return this.request<ApiModelProvider>('/providers', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateProvider(
    id: string,
    data: Partial<{
      name: string
      description: string
      provider_type: string
      base_url: string
      api_key: string
      visibility: ProviderVisibility
      grants: ProviderGrant[]
    }>,
  ): Promise<ApiModelProvider> {
    return this.request<ApiModelProvider>(`/providers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async deleteProvider(id: string): Promise<void> {
    await this.request<void>(`/providers/${id}`, { method: 'DELETE' })
  }

  async listProviderGrants(providerId: string): Promise<ApiProviderGrant[]> {
    return this.request<ApiProviderGrant[]>(`/providers/${providerId}/grants`)
  }

  async setProviderGrants(
    providerId: string,
    grants: ProviderGrant[],
  ): Promise<ApiProviderGrant[]> {
    return this.request<ApiProviderGrant[]>(`/providers/${providerId}/grants`, {
      method: 'PUT',
      body: JSON.stringify({ grants }),
    })
  }

  async listProviderModels(id: string): Promise<{ id: string; name: string }[]> {
    const res = await this.request<{ models: { id: string; name: string }[]; error?: string }>(
      `/providers/${id}/models`,
    )
    return res.models ?? []
  }

  async testProvider(
    id: string,
    opts?: {
      model?: string
      /** Optional draft config to probe instead of the stored values (blank
       * api_key keeps the stored key). */
      provider_type?: string
      base_url?: string
      api_key?: string
    },
  ): Promise<{ ok: boolean; detail?: string }> {
    return this.request<{ ok: boolean; detail?: string }>(`/providers/${id}/test`, {
      method: 'POST',
      body: JSON.stringify(opts ?? {}),
    })
  }

  // Templates
  async listTemplates(): Promise<ApiTemplate[]> {
    return this.request<ApiTemplate[]>('/templates')
  }

  // ── Workspace layouts (reusable named skeletons) ──
  async listWorkspaceLayouts(): Promise<ApiWorkspaceLayout[]> {
    return this.request<ApiWorkspaceLayout[]>('/workspace-layouts')
  }

  async getWorkspaceLayout(id: string): Promise<ApiWorkspaceLayout> {
    return this.request<ApiWorkspaceLayout>(`/workspace-layouts/${id}`)
  }

  async createWorkspaceLayout(data: {
    name: string
    description?: string
    skeleton: LayoutSkeleton
  }): Promise<ApiWorkspaceLayout> {
    return this.request<ApiWorkspaceLayout>('/workspace-layouts', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateWorkspaceLayout(
    id: string,
    data: Partial<{ name: string; description: string; skeleton: LayoutSkeleton }>,
  ): Promise<ApiWorkspaceLayout> {
    return this.request<ApiWorkspaceLayout>(`/workspace-layouts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async deleteWorkspaceLayout(id: string): Promise<void> {
    await this.request<void>(`/workspace-layouts/${id}`, { method: 'DELETE' })
  }

  async saveAsTemplate(
    workspaceId: string,
    data: {
      name: string
      description?: string
      bind?: boolean
      include_commands?: boolean
      include_schedules?: boolean
      include_layout?: boolean
    },
  ): Promise<ApiTemplate> {
    return this.request<ApiTemplate>(`/workspaces/${workspaceId}/save-as-template`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async syncTemplate(
    workspaceId: string,
    scheduleOverrides?: Record<string, boolean>,
  ): Promise<{ success: boolean; version: number }> {
    // Always send a JSON body — the route declares an (optional) JSON body, and
    // an empty body with a JSON content-type fails to parse server-side.
    return this.request<{ success: boolean; version: number }>(
      `/workspaces/${workspaceId}/sync-template`,
      {
        method: 'POST',
        body: JSON.stringify(scheduleOverrides ? { schedule_overrides: scheduleOverrides } : {}),
      },
    )
  }

  async getTemplate(id: string): Promise<ApiTemplate> {
    return this.request<ApiTemplate>(`/templates/${id}`)
  }

  async createTemplate(data: {
    name: string
    description?: string
    visibility?: TemplateVisibility
  }): Promise<ApiTemplate> {
    return this.request<ApiTemplate>('/templates', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateTemplate(
    id: string,
    data: Partial<{
      name: string
      description: string
      visibility: TemplateVisibility
      grants: TemplateGrant[]
    }>,
  ): Promise<ApiTemplate> {
    return this.request<ApiTemplate>(`/templates/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async deleteTemplate(id: string): Promise<void> {
    await this.request<void>(`/templates/${id}`, { method: 'DELETE' })
  }

  async listTemplateGrants(templateId: string): Promise<ApiTemplateGrant[]> {
    return this.request<ApiTemplateGrant[]>(`/templates/${templateId}/grants`)
  }

  async setTemplateGrants(
    templateId: string,
    grants: TemplateGrant[],
  ): Promise<ApiTemplateGrant[]> {
    return this.request<ApiTemplateGrant[]>(`/templates/${templateId}/grants`, {
      method: 'PUT',
      body: JSON.stringify({ grants }),
    })
  }

  async listTemplateVersions(templateId: string): Promise<ApiTemplateVersion[]> {
    return this.request<ApiTemplateVersion[]>(`/templates/${templateId}/versions`)
  }

  async getTemplateVersion(templateId: string, version: number): Promise<ApiTemplateVersion> {
    return this.request<ApiTemplateVersion>(`/templates/${templateId}/versions/${version}`)
  }

  async createTemplateVersion(
    templateId: string,
    data: {
      agent_type?: string
      system_prompt?: string
      prompt_id?: string | null
      prompt_version?: number | null
      mcp_config?: string
      agent_settings?: string
      compute_resources?: Record<string, any>
      provider_id?: string | null
      model?: string
      small_model?: string
      /** p3: skill UUIDs. */
      skill_ids?: string[]
      commands?: {
        name: string
        type?: 'plain' | 'struct'
        prompt_id?: string | null
        content?: string
        sort_order?: number
      }[]
      schedules?: {
        name: string
        cron: string
        timezone?: string
        prompt?: string
        prompt_id?: string | null
        enabled_default?: boolean
        sort_order?: number
      }[]
      /** Layout link to ship; carried through edit/rollback so it isn't dropped. */
      layout_id?: string | null
    },
  ): Promise<ApiTemplateVersion> {
    return this.request<ApiTemplateVersion>(`/templates/${templateId}/versions`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  // Prompts
  async listPrompts(): Promise<ApiPrompt[]> {
    return this.request<ApiPrompt[]>('/prompts')
  }

  async listPublicPrompts(): Promise<ApiPrompt[]> {
    return this.request<ApiPrompt[]>('/prompts/public')
  }

  async getPrompt(id: string): Promise<ApiPrompt> {
    return this.request<ApiPrompt>(`/prompts/${id}`)
  }

  async createPrompt(data: {
    name: string
    content?: string
    visibility?: PromptVisibility
    grants?: PromptGrant[]
  }): Promise<ApiPrompt> {
    return this.request<ApiPrompt>('/prompts', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updatePrompt(
    id: string,
    data: Partial<{
      name: string
      content: string
      visibility: PromptVisibility
      grants: PromptGrant[]
    }>,
  ): Promise<ApiPrompt> {
    return this.request<ApiPrompt>(`/prompts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async listPromptGrants(promptId: string): Promise<ApiPromptGrant[]> {
    return this.request<ApiPromptGrant[]>(`/prompts/${promptId}/grants`)
  }

  async setPromptGrants(promptId: string, grants: PromptGrant[]): Promise<ApiPromptGrant[]> {
    return this.request<ApiPromptGrant[]>(`/prompts/${promptId}/grants`, {
      method: 'PUT',
      body: JSON.stringify({ grants }),
    })
  }

  async deletePrompt(id: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/prompts/${id}`, {
      method: 'DELETE',
    })
  }

  async listPromptVersions(promptId: string): Promise<ApiPromptVersion[]> {
    return this.request<ApiPromptVersion[]>(`/prompts/${promptId}/versions`)
  }

  async rollbackPrompt(id: string, version: number): Promise<ApiPrompt> {
    return this.request<ApiPrompt>(`/prompts/${id}/rollback`, {
      method: 'POST',
      body: JSON.stringify({ version }),
    })
  }

  // Tags
  async listTags(): Promise<Tag[]> {
    return this.request<Tag[]>('/tags')
  }

  async createTag(data: { name: string; color?: string }): Promise<Tag> {
    return this.request<Tag>('/tags', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateTag(id: string, data: { name?: string; color?: string }): Promise<Tag> {
    return this.request<Tag>(`/tags/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async deleteTag(id: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/tags/${id}`, {
      method: 'DELETE',
    })
  }

  async setWorkspaceTags(workspaceId: string, tagIds: string[]): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/tags/workspace/${workspaceId}`, {
      method: 'PUT',
      body: JSON.stringify({ tag_ids: tagIds }),
    })
  }

  // Schedules (workspace sub-resource)
  async listSchedules(workspaceId: string): Promise<Schedule[]> {
    const res = await this.request<{ schedules: Schedule[] }>(
      `/workspaces/${workspaceId}/schedules`,
    )
    return res.schedules
  }

  async createSchedule(
    workspaceId: string,
    data: {
      name: string
      cron?: string | null
      run_at?: string | null
      timezone: string
      prompt: string
      prompt_id?: string | null
    },
  ): Promise<Schedule> {
    const res = await this.request<{ schedule: Schedule }>(`/workspaces/${workspaceId}/schedules`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
    return res.schedule
  }

  async updateSchedule(
    workspaceId: string,
    id: string,
    data: Partial<
      Pick<Schedule, 'name' | 'cron' | 'run_at' | 'timezone' | 'prompt' | 'prompt_id' | 'enabled'>
    >,
  ): Promise<Schedule> {
    const res = await this.request<{ schedule: Schedule }>(
      `/workspaces/${workspaceId}/schedules/${id}`,
      {
        method: 'PATCH',
        body: JSON.stringify(data),
      },
    )
    return res.schedule
  }

  async deleteSchedule(workspaceId: string, id: string): Promise<void> {
    await this.request<{ success: boolean }>(`/workspaces/${workspaceId}/schedules/${id}`, {
      method: 'DELETE',
    })
  }

  async runSchedule(workspaceId: string, id: string): Promise<{ job_id: string | null }> {
    return this.request<{ job_id: string | null }>(
      `/workspaces/${workspaceId}/schedules/${id}/run`,
      { method: 'POST' },
    )
  }

  // Agent requests (generic human-in-loop primitive — Builder Mode propose/apply)
  async getAgentRequest(workspaceId: string, reqId: string): Promise<ApiAgentRequest> {
    return this.request<ApiAgentRequest>(`/workspaces/${workspaceId}/agent-requests/${reqId}`)
  }

  async resolveAgentRequest(
    workspaceId: string,
    reqId: string,
    decision: 'approved' | 'rejected',
    reason?: string,
  ): Promise<ApiAgentRequest> {
    return this.request<ApiAgentRequest>(
      `/workspaces/${workspaceId}/agent-requests/${reqId}/resolve`,
      { method: 'POST', body: JSON.stringify({ decision, reason }) },
    )
  }

  // Workspace commands
  async listCommands(workspaceId: string): Promise<WorkspaceCommand[]> {
    const res = await this.request<{ commands: WorkspaceCommand[] }>(
      `/workspaces/${workspaceId}/commands`,
    )
    return res.commands
  }

  async createCommand(
    workspaceId: string,
    data: {
      name: string
      type: 'plain' | 'struct'
      prompt_id?: string | null
      content?: string
      sort_order?: number
    },
  ): Promise<WorkspaceCommand> {
    const res = await this.request<{ command: WorkspaceCommand }>(
      `/workspaces/${workspaceId}/commands`,
      {
        method: 'POST',
        body: JSON.stringify(data),
      },
    )
    return res.command
  }

  async updateCommand(
    workspaceId: string,
    id: string,
    data: Partial<
      Pick<WorkspaceCommand, 'name' | 'type' | 'prompt_id' | 'content' | 'sort_order' | 'disabled'>
    >,
  ): Promise<WorkspaceCommand> {
    const res = await this.request<{ command: WorkspaceCommand }>(
      `/workspaces/${workspaceId}/commands/${id}`,
      { method: 'PATCH', body: JSON.stringify(data) },
    )
    return res.command
  }

  async deleteCommand(workspaceId: string, id: string): Promise<void> {
    await this.request<{ success: boolean }>(`/workspaces/${workspaceId}/commands/${id}`, {
      method: 'DELETE',
    })
  }

  /** Enable/disable a template-provided command for this workspace (by name). */
  async setCommandDisabled(workspaceId: string, name: string, disabled: boolean): Promise<void> {
    await this.request<{ success: boolean }>(`/workspaces/${workspaceId}/commands/set-disabled`, {
      method: 'POST',
      body: JSON.stringify({ name, disabled }),
    })
  }

  // Agent info
  async getAgentInfo(workspaceId: string): Promise<AgentInfo | null> {
    const url = `/_proxy/agent/${workspaceId}/info`
    const response = await fetch(url, { credentials: 'include' })
    if (!response.ok) return null
    return response.json()
  }

  // Shares
  async createShare(workspaceId: string, sessionId: string, title?: string): Promise<ApiShare> {
    return this.request<ApiShare>('/shares', {
      method: 'POST',
      body: JSON.stringify({ workspace_id: workspaceId, session_id: sessionId, title }),
    })
  }

  async getSessionShares(workspaceId: string, sessionId: string): Promise<ApiShare[]> {
    return this.request<ApiShare[]>(
      `/shares?workspace_id=${encodeURIComponent(workspaceId)}&session_id=${encodeURIComponent(sessionId)}`,
    )
  }

  async getWorkspaceShares(workspaceId: string): Promise<ApiShare[]> {
    return this.request<ApiShare[]>(`/shares?workspace_id=${encodeURIComponent(workspaceId)}`)
  }

  async updateShare(id: string, title: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/shares/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    })
  }

  async deleteShare(id: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/shares/${id}`, { method: 'DELETE' })
  }

  // Service Tokens
  async listServiceTokens(): Promise<ApiServiceToken[]> {
    return this.request<ApiServiceToken[]>('/service-tokens')
  }

  async createServiceToken(name: string): Promise<ApiServiceToken> {
    return this.request<ApiServiceToken>('/service-tokens', {
      method: 'POST',
      body: JSON.stringify({ name }),
    })
  }

  async deleteServiceToken(id: string): Promise<void> {
    await this.request(`/service-tokens/${id}`, { method: 'DELETE' })
  }

  // Applications (OAuth clients)
  async listApplications(): Promise<ApiApplication[]> {
    return this.request<ApiApplication[]>('/applications')
  }

  async createApplication(input: {
    id?: string
    name: string
    description?: string | null
    homepage_url?: string | null
    redirect_uris: string[]
  }): Promise<ApiApplicationSecret> {
    return this.request<ApiApplicationSecret>('/applications', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  async updateApplication(
    id: string,
    input: {
      name?: string
      description?: string | null
      homepage_url?: string | null
      redirect_uris?: string[]
    },
  ): Promise<void> {
    await this.request(`/applications/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    })
  }

  async rotateApplicationSecret(id: string): Promise<ApiApplicationSecret> {
    return this.request<ApiApplicationSecret>(`/applications/${id}/rotate-secret`, {
      method: 'POST',
    })
  }

  async deleteApplication(id: string): Promise<void> {
    await this.request(`/applications/${id}`, { method: 'DELETE' })
  }

  async getPublicShare(id: string): Promise<ApiShareData> {
    const response = await fetch(`/api/shares/public/${id}`)
    if (!response.ok) {
      throw new Error('Share not found')
    }
    return response.json()
  }

  // ── MCP Catalog ──

  async getMcpCatalog(): Promise<McpCatalogEntry[]> {
    return this.request('/mcp-catalog')
  }

  // ── Workspace UI plugins (install state, decoupled from MCP) ──

  async getWorkspacePlugins(workspaceId: string): Promise<WorkspacePluginEntry[]> {
    return this.request(`/workspaces/${workspaceId}/plugins`)
  }

  async installWorkspacePlugin(workspaceId: string, pluginId: string): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/plugins`, {
      method: 'POST',
      body: JSON.stringify({ plugin_id: pluginId }),
    })
  }

  async uninstallWorkspacePlugin(
    workspaceId: string,
    pluginId: string,
  ): Promise<{ success: boolean }> {
    return this.request(`/workspaces/${workspaceId}/plugins/${pluginId}`, {
      method: 'DELETE',
    })
  }

  // ── MCP OAuth ──

  async discoverMcpOAuth(
    url: string,
  ): Promise<{ oauth_required: boolean; server_origin?: string }> {
    return this.request('/mcp-oauth/discover', {
      method: 'POST',
      body: JSON.stringify({ url }),
    })
  }

  async getMcpOAuthStatus(
    serverOrigins: string[],
  ): Promise<Record<string, { connected: boolean; expires_at?: string }>> {
    return this.request(
      `/mcp-oauth/status?servers=${serverOrigins.map(encodeURIComponent).join(',')}`,
    )
  }

  async getMcpOAuthAuthorizeUrl(
    serverOrigin: string,
    workspaceId: string,
  ): Promise<{ authorization_url: string }> {
    return this.request(
      `/mcp-oauth/authorize?server_origin=${encodeURIComponent(serverOrigin)}&workspace_id=${encodeURIComponent(workspaceId)}`,
    )
  }

  async disconnectMcpOAuth(serverOrigin: string): Promise<void> {
    return this.request(`/mcp-oauth/${encodeURIComponent(serverOrigin)}`, { method: 'DELETE' })
  }

  // WeChat Work Auth
  async getWeComEnabled(): Promise<{ enabled: boolean }> {
    return this.request('/auth/wecom/enabled')
  }

  async getWeComAuthorizeUrl(mode: 'login' | 'bind'): Promise<{ url: string }> {
    return this.request(`/auth/wecom/authorize?mode=${mode}`)
  }

  async getIdentities(): Promise<
    { provider: string; display_name: string | null; external_id: string; created_at: string }[]
  > {
    return this.request('/auth/wecom/identities')
  }

  async unbindWeCom(): Promise<void> {
    await this.request('/auth/wecom/identity', { method: 'DELETE' })
  }

  // Notification Preferences
  async getNotificationPreferences(
    scope?: string,
  ): Promise<{ event_type: string; channel: string; scope: string; enabled: boolean }[]> {
    const qs = scope ? `?scope=${encodeURIComponent(scope)}` : ''
    return this.request(`/notifications/preferences${qs}`)
  }

  async setNotificationPreference(
    eventType: string,
    channel: string,
    enabled: boolean,
    scope = '*',
  ): Promise<void> {
    await this.request('/notifications/preferences', {
      method: 'PUT',
      body: JSON.stringify({ event_type: eventType, channel, enabled, scope }),
    })
  }

  async deleteNotificationPreference(
    eventType: string,
    channel: string,
    scope: string,
  ): Promise<void> {
    await this.request('/notifications/preferences', {
      method: 'DELETE',
      body: JSON.stringify({ event_type: eventType, channel, scope }),
    })
  }

  // Admin
  async getAdminTotals(): Promise<AdminTotals> {
    return this.request('/admin/stats/totals')
  }
  async getAdminTrends(): Promise<AdminTrend[]> {
    return this.request('/admin/stats/trends')
  }
  async getAdminTokenUsage(): Promise<AdminTokenUsage> {
    return this.request('/admin/stats/token-usage')
  }
  async getAdminAgentTypes(): Promise<AdminAgentType[]> {
    return this.request('/admin/stats/agent-types')
  }
  async getAdminSessionSources(): Promise<AdminSessionSource[]> {
    return this.request('/admin/stats/session-sources')
  }
  async getAdminPowerUsers(): Promise<AdminPowerUser[]> {
    return this.request('/admin/stats/power-users')
  }
  async getAdminPowerAgents(): Promise<AdminPowerAgent[]> {
    return this.request('/admin/stats/power-agents')
  }
  async getAdminSkillUsage(): Promise<AdminSkillUsage[]> {
    return this.request('/admin/stats/skill-usage')
  }
  async getAdminMcpUsage(): Promise<AdminMcpUsage[]> {
    return this.request('/admin/stats/mcp-usage')
  }
  async getAdminCluster(): Promise<AdminCluster> {
    return this.request('/admin/cluster')
  }

  // Admin — System settings (global, admin-only)
  async getSystemSettings(): Promise<{
    asr_active_provider: string | null
    asr_providers: Record<string, unknown>
    asr_available_providers: string[]
  }> {
    return this.request('/admin/system-settings')
  }

  async updateSystemSettings(patch: {
    asr_active_provider?: string | null
    asr_providers?: Record<string, unknown>
  }): Promise<{
    asr_active_provider: string | null
    asr_providers: Record<string, unknown>
  }> {
    return this.request('/admin/system-settings', {
      method: 'PUT',
      body: JSON.stringify(patch),
    })
  }

  // Admin — User management
  async getAdminUsers(): Promise<AdminUser[]> {
    return this.request('/admin/users')
  }
  async createAdminUser(data: {
    username: string
    display_name: string
    password: string
    email?: string
    role?: 'user' | 'admin'
  }): Promise<{ id: string; username: string }> {
    return this.request('/admin/users', { method: 'POST', body: JSON.stringify(data) })
  }
  async resetAdminUserPassword(userId: string, password: string): Promise<void> {
    return this.request(`/admin/users/${userId}/password`, {
      method: 'PUT',
      body: JSON.stringify({ password }),
    })
  }
  async deleteAdminUser(userId: string): Promise<void> {
    return this.request(`/admin/users/${userId}`, { method: 'DELETE' })
  }

  // Sandboxes
  async listWorkspaceSandboxes(workspaceId: string): Promise<SandboxListResponse> {
    return this.request<SandboxListResponse>(`/workspaces/${workspaceId}/sandboxes`)
  }

  async createWorkspaceSandbox(
    workspaceId: string,
    data: {
      image: string
      resource?: Record<string, string>
      timeout_seconds?: number
      env?: Record<string, string>
    },
  ): Promise<SandboxInfo> {
    return this.request<SandboxInfo>(`/workspaces/${workspaceId}/sandboxes`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async deleteWorkspaceSandbox(
    workspaceId: string,
    sandboxId: string,
  ): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/workspaces/${workspaceId}/sandboxes/${sandboxId}`, {
      method: 'DELETE',
    })
  }

  // Browsers
  async listWorkspaceBrowsers(workspaceId: string): Promise<BrowserListResponse> {
    return this.request<BrowserListResponse>(`/workspaces/${workspaceId}/browsers`)
  }

  async createWorkspaceBrowser(
    workspaceId: string,
    data?: { timeout_seconds?: number },
  ): Promise<BrowserSession> {
    return this.request<BrowserSession>(`/workspaces/${workspaceId}/browsers`, {
      method: 'POST',
      body: JSON.stringify(data ?? {}),
    })
  }

  async getWorkspaceBrowser(workspaceId: string, browserId: string): Promise<BrowserSession> {
    return this.request<BrowserSession>(`/workspaces/${workspaceId}/browsers/${browserId}`)
  }

  async renewWorkspaceBrowser(
    workspaceId: string,
    browserId: string,
    timeoutSeconds?: number,
  ): Promise<{ expires_at: string }> {
    return this.request<{ expires_at: string }>(
      `/workspaces/${workspaceId}/browsers/${browserId}/renew`,
      {
        method: 'POST',
        body: JSON.stringify({ timeout_seconds: timeoutSeconds }),
      },
    )
  }

  async deleteWorkspaceBrowser(
    workspaceId: string,
    browserId: string,
  ): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/workspaces/${workspaceId}/browsers/${browserId}`, {
      method: 'DELETE',
    })
  }
}

export const api = new ApiClient()
