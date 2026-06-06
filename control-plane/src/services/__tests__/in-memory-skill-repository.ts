/**
 * InMemorySkillRepository — SQL-faithful fake of cp's read-only slice of the
 * p3 skills model. Production cp does not write skills / skill_sources /
 * skill_versions (scs owns those); the fake mirrors that. Relation tables
 * (workspace_skills, skill_grants, template_version_skills) ARE written by
 * cp and the fake honors that.
 *
 * Test scaffolding lives on `_seed*` helpers — they bypass the would-be
 * service-layer write paths to set up fixtures the production interface
 * intentionally doesn't expose.
 */
import { createHash, randomUUID } from 'node:crypto'
import type {
  SkillMeta,
  SkillSource,
  SkillSourceKind,
  SkillVersion,
  SkillVisibility,
  Workspace,
} from '../db/types'
import {
  type ListSkillsFilters,
  type SkillDeleteBlockers,
  type SkillDependents,
  type SkillGrantInput,
  type SkillGrantRow,
  type SkillRepository,
  type SkillWithAccess,
  UNCATEGORIZED_SENTINEL,
  type WorkspaceSkillRow,
} from '../skill-repository'

interface SourceRow extends SkillSource {
  draft_package: Buffer | null
}

interface VersionRow extends SkillVersion {
  package: Buffer
}

interface GrantRow {
  skill_id: string
  team_id: string
  permission: 'viewer' | 'editor'
  granted_by: string
  granted_at: string
}

interface UserRow {
  id: string
  display_name: string
}

interface TeamRow {
  id: string
  name: string
}

interface TemplateVersionRef {
  template_version_id: string
  skill_id: string
}

export class InMemorySkillRepository implements SkillRepository {
  private skills = new Map<string, SkillMeta>() // id → meta
  private sources = new Map<string, SourceRow>()
  private versions = new Map<string, VersionRow>()
  private grants: GrantRow[] = []
  private workspaceSkills = new Set<string>() // `${workspace_id}:${skill_id}`
  private templateVersionSkills: TemplateVersionRef[] = []
  private users = new Map<string, UserRow>()
  private teams = new Map<string, TeamRow>()
  private teamMembers = new Set<string>() // `${team_id}:${user_id}`
  private workspaces = new Map<string, Workspace>()
  private clock = 0

  // ── seed (test helpers) ────────────────────────────────────────────────

  seedUser(user: UserRow): void {
    this.users.set(user.id, user)
  }
  seedTeam(team: TeamRow, memberIds: string[] = []): void {
    this.teams.set(team.id, team)
    for (const uid of memberIds) this.teamMembers.add(`${team.id}:${uid}`)
  }
  seedWorkspace(ws: Workspace): void {
    this.workspaces.set(ws.id, ws)
  }
  seedTemplateVersionSkill(templateVersionId: string, skillId: string): void {
    this.templateVersionSkills.push({ template_version_id: templateVersionId, skill_id: skillId })
  }

  /**
   * Bootstrap a skill + its source + its initial version in one call. Stand-in
   * for what scs does in production, so SkillsService UT can land fixtures
   * without going over HTTP.
   */
  _seedSkillWithVersion(input: {
    userId: string
    name: string
    description?: string
    visibility: SkillVisibility
    category?: string | null
    sourceKind?: SkillSourceKind
    subpath?: string
    package?: Buffer
  }): { skill: SkillMeta; source: SkillSource; version: SkillVersion } {
    const source =
      input.sourceKind === 'git'
        ? this.seedGitSourceSync({ user_id: input.userId })
        : this.seedNativeSourceSync(input.userId)
    const { skill, version } = this.insertSkillAndVersionSync({
      source_id: source.id,
      user_id: input.userId,
      name: input.name,
      subpath: input.subpath ?? '',
      description: input.description ?? '',
      visibility: input.visibility,
      category: input.category ?? null,
      package: input.package ?? Buffer.from('pkg'),
      commit_sha: null,
      note: null,
    })
    return { skill, source, version }
  }

  /** Append a new version onto an existing skill — mirrors scs `/versions` POST. */
  _seedVersion(input: {
    skillId: string
    package?: Buffer
    commitSha?: string | null
    note?: string | null
    publishedBy?: string
    setActive?: boolean
  }): SkillVersion {
    const skill = this.skills.get(input.skillId)
    if (!skill) throw new Error(`skill ${input.skillId} not seeded`)
    const pkg = input.package ?? Buffer.from('pkg2')
    const contentHash = this.hashOf(pkg)
    const existing = Array.from(this.versions.values()).find(
      (v) => v.skill_id === input.skillId && v.content_hash === contentHash,
    )
    const version: VersionRow = existing
      ? existing
      : {
          id: randomUUID(),
          skill_id: input.skillId,
          source_id: skill.source_id,
          package: pkg,
          content_hash: contentHash,
          commit_sha: input.commitSha ?? null,
          note: input.note ?? null,
          published_at: this.now(),
          published_by: input.publishedBy ?? skill.user_id,
        }
    if (!existing) this.versions.set(version.id, version)
    if (input.setActive !== false) {
      skill.active_version_id = version.id
      skill.updated_at = this.now()
    }
    return this.projectVersion(version)
  }

  _peek(id: string): SkillMeta | undefined {
    return this.skills.get(id)
  }
  _peekGrants(): readonly GrantRow[] {
    return this.grants
  }

  // ── invariants ─────────────────────────────────────────────────────────

  private now(): string {
    this.clock += 1
    return new Date(1700000000000 + this.clock).toISOString()
  }

  private hashOf(buf: Buffer): string {
    return createHash('sha256').update(buf).digest('hex')
  }

  // ── skills (read) ──────────────────────────────────────────────────────

  async listVisibleToUser(
    userId: string,
    filters: ListSkillsFilters = {},
  ): Promise<SkillWithAccess[]> {
    const q = filters.query?.trim().toLowerCase() ?? null
    const owner = filters.ownerId?.trim() || null
    const visibility = filters.visibility ?? null
    const cats = (filters.categories ?? []).map((c) => c.trim()).filter(Boolean)
    const wantUncategorized = cats.includes(UNCATEGORIZED_SENTINEL)
    const categoryValues = new Set(cats.filter((c) => c !== UNCATEGORIZED_SENTINEL))
    const categoryFilterActive = categoryValues.size > 0 || wantUncategorized
    const out: SkillWithAccess[] = []
    for (const row of this.skills.values()) {
      if (owner && row.user_id !== owner) continue
      if (visibility && row.visibility !== visibility) continue
      if (q) {
        const hay = `${row.name}\n${row.description ?? ''}`.toLowerCase()
        if (!hay.includes(q)) continue
      }
      if (categoryFilterActive) {
        const matchesValue = row.category !== null && categoryValues.has(row.category)
        const matchesUncategorized = wantUncategorized && row.category === null
        if (!matchesValue && !matchesUncategorized) continue
      }
      const decorated = this.decorateOrNull(row, userId)
      if (decorated) out.push(decorated)
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }

  async getSkillForUser(id: string, userId: string): Promise<SkillWithAccess | null> {
    const row = this.skills.get(id)
    if (!row) return null
    return this.decorateOrNull(row, userId)
  }

  async getSkillByNameForUser(name: string, ownerId: string): Promise<SkillMeta | null> {
    for (const row of this.skills.values()) {
      if (row.user_id === ownerId && row.name === name) return row
    }
    return null
  }

  async getWritableSkillByName(name: string, userId: string): Promise<SkillMeta | null> {
    const owned = await this.getSkillByNameForUser(name, userId)
    if (owned) return owned
    for (const row of this.skills.values()) {
      if (row.name !== name) continue
      const editor = this.grants.find(
        (g) =>
          g.skill_id === row.id &&
          g.permission === 'editor' &&
          this.teamMembers.has(`${g.team_id}:${userId}`),
      )
      if (editor) return row
    }
    return null
  }

  async getSkillMeta(id: string): Promise<SkillMeta | null> {
    return this.skills.get(id) ?? null
  }

  async listSkills(): Promise<SkillMeta[]> {
    return Array.from(this.skills.values()).sort((a, b) => a.name.localeCompare(b.name))
  }

  // ── sources / versions (read) ──────────────────────────────────────────

  async getSource(id: string): Promise<SkillSource | null> {
    const row = this.sources.get(id)
    return row ? this.projectSource(row) : null
  }

  async findGitSource(userId: string, gitUrl: string, gitRef: string): Promise<SkillSource | null> {
    for (const row of this.sources.values()) {
      if (
        row.kind === 'git' &&
        row.user_id === userId &&
        row.git_url === gitUrl &&
        row.git_ref === gitRef
      )
        return this.projectSource(row)
    }
    return null
  }

  async listSourcesForUser(userId: string, kind?: SkillSourceKind): Promise<SkillSource[]> {
    return Array.from(this.sources.values())
      .filter((s) => s.user_id === userId && (!kind || s.kind === kind))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((s) => this.projectSource(s))
  }

  async listSkillsForSource(sourceId: string): Promise<SkillMeta[]> {
    return Array.from(this.skills.values())
      .filter((s) => s.source_id === sourceId)
      .sort((a, b) => (a.subpath + a.name).localeCompare(b.subpath + b.name))
  }

  async listVersions(skillId: string): Promise<SkillVersion[]> {
    return Array.from(this.versions.values())
      .filter((v) => v.skill_id === skillId)
      .sort((a, b) => b.published_at.localeCompare(a.published_at))
      .map((v) => this.projectVersion(v))
  }

  async getVersion(versionId: string): Promise<SkillVersion | null> {
    const row = this.versions.get(versionId)
    return row ? this.projectVersion(row) : null
  }

  // ── delete blockers ────────────────────────────────────────────────────

  async getDeleteBlockers(skillId: string): Promise<SkillDeleteBlockers> {
    const workspaceIds: string[] = []
    for (const key of this.workspaceSkills) {
      const [wsId, sid] = key.split(':')
      if (sid === skillId) workspaceIds.push(wsId)
    }
    const templateVersionIds = this.templateVersionSkills
      .filter((r) => r.skill_id === skillId)
      .map((r) => r.template_version_id)
    return {
      workspace_ids: workspaceIds,
      template_version_ids: templateVersionIds,
    }
  }

  async getSkillDependents(skillId: string, ownerId: string): Promise<SkillDependents> {
    const ownWorkspaces: { id: string; name: string }[] = []
    let otherCount = 0
    for (const key of this.workspaceSkills) {
      const [wsId, sid] = key.split(':')
      if (sid !== skillId) continue
      const ws = this.workspaces.get(wsId)
      if (!ws) continue
      if (ws.user_id === ownerId) ownWorkspaces.push({ id: ws.id, name: ws.name })
      else otherCount++
    }
    ownWorkspaces.sort((a, b) => a.name.localeCompare(b.name))
    const templateVersionCount = this.templateVersionSkills.filter(
      (r) => r.skill_id === skillId,
    ).length
    return {
      own_workspaces: ownWorkspaces,
      other_workspace_count: otherCount,
      template_version_count: templateVersionCount,
    }
  }

  // ── grants ─────────────────────────────────────────────────────────────

  async listSkillGrants(skillId: string): Promise<SkillGrantRow[]> {
    return this.grants
      .filter((g) => g.skill_id === skillId)
      .map((g) => ({
        team_id: g.team_id,
        team_name: this.teams.get(g.team_id)?.name ?? '',
        permission: g.permission,
        granted_at: g.granted_at,
      }))
      .sort((a, b) => a.granted_at.localeCompare(b.granted_at))
  }

  async setSkillGrants(
    skillId: string,
    grants: SkillGrantInput[],
    grantedBy: string,
  ): Promise<void> {
    if (grants.length === 0) {
      this.grants = this.grants.filter((g) => g.skill_id !== skillId)
      return
    }
    const keepTeams = new Set(grants.map((g) => g.team_id))
    this.grants = this.grants.filter((g) => g.skill_id !== skillId || keepTeams.has(g.team_id))
    for (const g of grants) {
      const existing = this.grants.find((x) => x.skill_id === skillId && x.team_id === g.team_id)
      if (existing) {
        existing.permission = g.permission
        existing.granted_by = grantedBy
      } else {
        this.grants.push({
          skill_id: skillId,
          team_id: g.team_id,
          permission: g.permission,
          granted_by: grantedBy,
          granted_at: this.now(),
        })
      }
    }
  }

  // ── workspace ↔ skill ──────────────────────────────────────────────────

  async getWorkspaceSkillIds(workspaceId: string): Promise<string[]> {
    const out: string[] = []
    for (const key of this.workspaceSkills) {
      const [ws, skillId] = key.split(':')
      if (ws === workspaceId) out.push(skillId)
    }
    return out.sort()
  }

  async getWorkspaceSkillsForAgent(workspaceId: string): Promise<WorkspaceSkillRow[]> {
    const ids = await this.getWorkspaceSkillIds(workspaceId)
    const out: WorkspaceSkillRow[] = []
    for (const id of ids) {
      const meta = this.skills.get(id)
      if (!meta) continue
      out.push({
        id: meta.id,
        name: meta.name,
        user_id: meta.user_id,
        source_kind: meta.source_kind ?? null,
      })
    }
    return out
  }

  async setWorkspaceSkills(workspaceId: string, skillIds: string[]): Promise<void> {
    for (const key of Array.from(this.workspaceSkills)) {
      if (key.startsWith(`${workspaceId}:`)) this.workspaceSkills.delete(key)
    }
    for (const id of skillIds) this.workspaceSkills.add(`${workspaceId}:${id}`)
  }

  async findSkillIdsNotVisibleToUser(skillIds: string[], userId: string): Promise<string[]> {
    if (skillIds.length === 0) return []
    const visible = new Set<string>()
    for (const row of this.skills.values()) {
      if (row.user_id === userId || row.visibility === 'public') visible.add(row.id)
    }
    for (const g of this.grants) {
      if (this.teamMembers.has(`${g.team_id}:${userId}`)) visible.add(g.skill_id)
    }
    return skillIds.filter((id) => !visible.has(id))
  }

  async listWorkspacesUsingSkill(skillId: string): Promise<Workspace[]> {
    const out: Workspace[] = []
    for (const key of this.workspaceSkills) {
      const [wsId, sid] = key.split(':')
      if (sid !== skillId) continue
      const ws = this.workspaces.get(wsId)
      if (ws && ws.status === 'running') out.push(ws)
    }
    return out
  }

  async countNonOwnerWorkspacesUsingSkill(skillId: string, ownerId: string): Promise<number> {
    let count = 0
    for (const key of this.workspaceSkills) {
      const [wsId, sid] = key.split(':')
      if (sid !== skillId) continue
      const ws = this.workspaces.get(wsId)
      if (ws && ws.user_id !== ownerId) count++
    }
    return count
  }

  // ── internal helpers ───────────────────────────────────────────────────

  private projectSource(row: SourceRow): SkillSource {
    const { draft_package: _drop, ...rest } = row
    let skill_count = 0
    for (const s of this.skills.values()) if (s.source_id === row.id) skill_count++
    return { ...rest, has_draft: row.draft_package !== null, skill_count }
  }

  private projectVersion(row: VersionRow): SkillVersion {
    const { package: _drop, ...rest } = row
    return rest
  }

  private seedNativeSourceSync(userId: string): SkillSource {
    const row: SourceRow = {
      id: randomUUID(),
      user_id: userId,
      kind: 'native',
      git_type: null,
      git_url: null,
      git_host: null,
      git_owner: null,
      git_repo: null,
      git_ref: null,
      credential_name: null,
      last_commit_sha: null,
      last_synced_at: null,
      has_draft: false,
      skill_count: 0,
      draft_package: null,
      created_at: this.now(),
      updated_at: this.now(),
    }
    this.sources.set(row.id, row)
    return this.projectSource(row)
  }

  private seedGitSourceSync(input: { user_id: string }): SkillSource {
    const row: SourceRow = {
      id: randomUUID(),
      user_id: input.user_id,
      kind: 'git',
      git_type: 'github',
      git_url: 'https://github.com/example/repo.git',
      git_host: 'github.com',
      git_owner: 'example',
      git_repo: 'repo',
      git_ref: 'main',
      credential_name: null,
      last_commit_sha: 'deadbeef',
      last_synced_at: this.now(),
      has_draft: false,
      skill_count: 0,
      draft_package: null,
      created_at: this.now(),
      updated_at: this.now(),
    }
    this.sources.set(row.id, row)
    return this.projectSource(row)
  }

  private insertSkillAndVersionSync(input: {
    source_id: string
    user_id: string
    name: string
    subpath: string
    description: string
    visibility: SkillVisibility
    category: string | null
    package: Buffer
    commit_sha: string | null
    note: string | null
  }): { skill: SkillMeta; version: SkillVersion } {
    const owner = this.users.get(input.user_id)
    const now = this.now()
    const skillId = randomUUID()
    const versionId = randomUUID()
    const sourceRow = this.sources.get(input.source_id)
    const skill: SkillMeta = {
      id: skillId,
      source_id: input.source_id,
      source_kind: sourceRow?.kind ?? 'native',
      active_version_id: versionId,
      name: input.name,
      subpath: input.subpath,
      description: input.description,
      user_id: input.user_id,
      is_public: input.visibility === 'public',
      visibility: input.visibility,
      owner_name: owner?.display_name ?? '',
      category: input.category,
      created_at: now,
      updated_at: now,
    }
    const version: VersionRow = {
      id: versionId,
      skill_id: skillId,
      source_id: input.source_id,
      package: input.package,
      content_hash: this.hashOf(input.package),
      commit_sha: input.commit_sha,
      note: input.note,
      published_at: now,
      published_by: input.user_id,
    }
    this.skills.set(skillId, skill)
    this.versions.set(versionId, version)
    return { skill, version: this.projectVersion(version) }
  }

  private decorateOrNull(row: SkillMeta, userId: string): SkillWithAccess | null {
    const isOwner = row.user_id === userId
    const isPublic = row.visibility === 'public'

    const mySharedGrants = this.grants.filter(
      (g) => g.skill_id === row.id && this.teamMembers.has(`${g.team_id}:${userId}`),
    )
    const grantRank = mySharedGrants.reduce(
      (acc, g) => Math.max(acc, g.permission === 'editor' ? 2 : 1),
      0,
    )
    if (!isOwner && !isPublic && grantRank === 0) return null

    const my_permission: SkillWithAccess['my_permission'] = isOwner
      ? 'owner'
      : grantRank === 2
        ? 'editor'
        : grantRank === 1
          ? 'viewer'
          : 'public'
    const shared_via_teams = mySharedGrants.map((g) => ({
      id: g.team_id,
      name: this.teams.get(g.team_id)?.name ?? '',
      permission: g.permission,
    }))
    return {
      ...row,
      is_owner: isOwner,
      my_permission,
      shared_via_teams,
    }
  }
}
