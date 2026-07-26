/**
 * SkillsService — orchestration layer for the skills bounded context.
 *
 * p3 contract: scs owns all writes to `skills`, `skill_sources`,
 * `skill_versions`. SkillsService reads cp-local state (relations + meta
 * via the shared pool), validates ACL, then delegates content mutations
 * over HTTP to scs. Workspace reload notifications and grant writes stay
 * in cp.
 *
 * Streamed write paths (upload, save-draft) pass the raw request body
 * straight to scs without materializing in cp memory.
 */
import {
  MAX_SKILL_SLUG_LENGTH,
  deriveSkillSlug,
  isValidSkillSlug,
} from '../../../internal/types/skill-slug'
import type { AgentNotifier, ReloadEnqueuer } from './agent-notifier'
import {
  DEFAULT_EXPORT_TTL_DAYS,
  type SkillExportToken,
  createSkillExportToken,
  deleteSkillExportToken,
  listSkillExportTokens,
} from './db/skill-export-tokens'
import type { SkillMeta, SkillSource, SkillVersion, SkillVisibility } from './db/types'
import type {
  ListSkillsFilters,
  SkillDeleteBlockers,
  SkillDependents,
  SkillGrantInput,
  SkillGrantRow,
  SkillRepository,
  SkillWithAccess,
} from './skill-repository'
import {
  type DraftFileNode,
  type ImportFromGitInput,
  type ScanCandidate,
  type ScanGitResult,
  type ScsResult,
  type SyncResult,
  type UploadInput,
  scsCreateNativeSource,
  scsDeleteDraft,
  scsDeleteDraftFile,
  scsDeleteSkill,
  scsDeleteSource,
  scsImportFromGit,
  scsListDraftTree,
  scsPatchSkill,
  scsPublishSkill,
  scsPutDraft,
  scsPutDraftFile,
  scsScanGit,
  scsScanTarball,
  scsSetActiveVersion,
  scsSwitchSkillToGit,
  scsSyncSource,
  scsUploadSkill,
} from './skills-content'
import {
  ConflictError,
  InvalidInputError,
  NotAllowedError,
  SkillNotFoundError,
} from './skills-errors'

export interface SkillsServiceDeps {
  isTeamMember(teamId: string, userId: string): Promise<boolean>
  getWorkspaceForAttach(workspaceId: string): Promise<{ user_id: string; status: string } | null>
}

// ── inputs ─────────────────────────────────────────────────────────────────

interface PatchMetaInput {
  userId: string
  skillId: string
  name?: string
  description?: string
  visibility?: SkillVisibility
  grants?: SkillGrantInput[]
  category?: string | null
}

interface UploadSkillInput {
  userId: string
  name: string
  description: string
  visibility: SkillVisibility
  category?: string | null
  body: ReadableStream<Uint8Array>
  contentLength?: number
  signal?: AbortSignal
}

interface CreateNativeSourceInput {
  userId: string
  name: string
  description: string
  visibility: SkillVisibility
  category?: string | null
}

interface ImportSkillInput {
  userId: string
  url: string
  type?: string
  ref?: string
  token?: string
  credentialName?: string | null
  subpath: string
  name?: string
  description?: string
  visibility: SkillVisibility
  category?: string | null
}

interface SwitchSkillToGitInput {
  userId: string
  skillId: string
  url: string
  type?: string
  ref?: string
  token?: string
  credentialName?: string | null
  subpath: string
}

interface SaveDraftInput {
  userId: string
  sourceId: string
  body: ReadableStream<Uint8Array>
  contentLength?: number
  signal?: AbortSignal
}

interface ScanGitInput {
  userId: string
  url: string
  type?: string
  ref?: string
  token?: string
}

// ── service ────────────────────────────────────────────────────────────────

// Visibility lattice for narrowing checks: private < team < public. A
// move to a lower rank can revoke access from already-attached workspaces.
const VISIBILITY_RANK: Record<SkillVisibility, number> = { private: 0, team: 1, public: 2 }

export class SkillsService {
  constructor(
    private readonly repo: SkillRepository,
    private readonly notifier: AgentNotifier,
    private readonly deps: SkillsServiceDeps,
    private readonly reloadQueue: ReloadEnqueuer,
  ) {}

  // ─── read ────────────────────────────────────────────────────────────────

  list(userId: string, filters?: ListSkillsFilters): Promise<SkillWithAccess[]> {
    return this.repo.listVisibleToUser(userId, filters)
  }

  /** Returns the skill (visible to user) or throws SkillNotFoundError. */
  async getSkill(userId: string, skillId: string): Promise<SkillWithAccess> {
    const skill = await this.repo.getSkillForUser(skillId, userId)
    if (!skill) throw new SkillNotFoundError()
    return skill
  }

  /** Unfiltered list used by the internal `/_cp/skills` route. */
  listAll(): Promise<SkillMeta[]> {
    return this.repo.listSkills()
  }

  /** Owner-only — list of sources the user owns. */
  async listSources(userId: string, kind?: 'git' | 'native'): Promise<SkillSource[]> {
    return this.repo.listSourcesForUser(userId, kind)
  }

  async getSource(userId: string, sourceId: string): Promise<SkillSource> {
    const source = await this.repo.getSource(sourceId)
    if (!source || source.user_id !== userId) throw new SkillNotFoundError('Source not found')
    return source
  }

  async listSkillsForSource(userId: string, sourceId: string): Promise<SkillMeta[]> {
    await this.getSource(userId, sourceId)
    return this.repo.listSkillsForSource(sourceId)
  }

  async listVersions(userId: string, skillId: string): Promise<SkillVersion[]> {
    const skill = await this.repo.getSkillForUser(skillId, userId)
    if (!skill) throw new SkillNotFoundError()
    return this.repo.listVersions(skillId)
  }

  // ─── create (delegated to scs) ───────────────────────────────────────────

  async scanGit(userId: string, input: ScanGitInput): Promise<ScanGitResult> {
    // Scan is read-only; visibility check is "the user is logged in". No
    // owner gate — anyone can paste a URL and see what's in it.
    void userId
    const result = await scsScanGit(input)
    this.unwrap(result)
    return result.value
  }

  async scanTarball(args: {
    userId: string
    body: ReadableStream<Uint8Array>
    contentLength?: number
    signal?: AbortSignal
  }): Promise<{ candidates: ScanCandidate[] }> {
    void args.userId
    const result = await scsScanTarball({
      body: args.body,
      contentLength: args.contentLength,
      signal: args.signal,
    })
    this.unwrap(result)
    return result.value
  }

  /** Create a native source + its (empty) skill row, ready for draft editing. */
  async createNativeSource(
    input: CreateNativeSourceInput,
  ): Promise<{ source: SkillSource; skill: SkillMeta }> {
    const result = await scsCreateNativeSource({
      user_id: input.userId,
      name: input.name,
      description: input.description,
      visibility: input.visibility,
      category: input.category ?? null,
    })
    this.unwrap(result)
    return result.value
  }

  /** Import a single subpath from a git repo. May reuse an existing source. */
  async importFromGit(
    input: ImportSkillInput,
  ): Promise<{ source: SkillSource; skill: SkillMeta; version: SkillVersion }> {
    const body: ImportFromGitInput = {
      user_id: input.userId,
      url: input.url,
      type: input.type,
      ref: input.ref,
      token: input.token,
      credential_name: input.credentialName ?? null,
      subpath: input.subpath,
      name: input.name,
      description: input.description,
      visibility: input.visibility,
      category: input.category ?? null,
    }
    const result = await scsImportFromGit(body)
    this.unwrap(result)
    // Re-importing an existing git skill replaces its active version, so
    // dependent workspaces must reload. (First import has no dependents yet,
    // making this a no-op fanout — safe to call unconditionally.)
    await this.notifyAffectedWorkspaces(result.value.skill.id)
    return result.value
  }

  /**
   * Switch an existing native skill to a git source in place. Owner-only and
   * native-only. The skill's UUID is preserved, so every mount survives — but
   * its native version history is wiped (only the fetched git version remains).
   * Destructive; the route layer is responsible for the user confirmation.
   */
  async switchSkillToGit(
    input: SwitchSkillToGitInput,
  ): Promise<{ source: SkillSource; skill: SkillMeta; version: SkillVersion }> {
    const skill = await this.repo.getSkillForUser(input.skillId, input.userId)
    if (!skill || !skill.is_owner) throw new SkillNotFoundError()
    if (skill.source_kind !== 'native')
      throw new ConflictError('Only native skills can switch to a git source')
    const result = await scsSwitchSkillToGit(input.skillId, {
      user_id: input.userId,
      url: input.url,
      type: input.type,
      ref: input.ref,
      token: input.token,
      credential_name: input.credentialName ?? null,
      subpath: input.subpath,
    })
    this.unwrap(result)
    // Content + source changed; dependent workspaces must reload.
    await this.notifyAffectedWorkspaces(input.skillId)
    return result.value
  }

  /** Upload a complete tarball; creates source + skill + first version. */
  async uploadSkill(
    input: UploadSkillInput,
  ): Promise<{ source: SkillSource; skill: SkillMeta; version: SkillVersion }> {
    const meta: UploadInput = {
      user_id: input.userId,
      name: input.name,
      description: input.description,
      visibility: input.visibility,
      category: input.category ?? null,
    }
    const result = await scsUploadSkill({
      meta,
      body: input.body,
      contentLength: input.contentLength,
      signal: input.signal,
    })
    this.unwrap(result)
    return result.value
  }

  // ─── draft (native) ──────────────────────────────────────────────────────

  /**
   * Owner OR editor on the source's owning skill may write the draft.
   * Mirrors pre-p3 PUT /:name re-upload semantics. 404s on the editor
   * miss so we don't leak source existence to unrelated users.
   */
  private async resolveNativeSourceForWrite(
    userId: string,
    sourceId: string,
  ): Promise<SkillSource> {
    const source = await this.repo.getSource(sourceId)
    if (!source) throw new SkillNotFoundError('Source not found')
    if (source.kind !== 'native')
      throw new InvalidInputError('Drafts are only valid for native sources')
    if (source.user_id === userId) return source
    const skills = await this.repo.listSkillsForSource(sourceId)
    for (const s of skills) {
      const access = await this.repo.getSkillForUser(s.id, userId)
      if (access?.my_permission === 'editor') return source
    }
    throw new SkillNotFoundError('Source not found')
  }

  async saveDraft(input: SaveDraftInput): Promise<{ ok: true; byte_count: number }> {
    await this.resolveNativeSourceForWrite(input.userId, input.sourceId)
    const result = await scsPutDraft({
      sourceId: input.sourceId,
      body: input.body,
      contentLength: input.contentLength,
      signal: input.signal,
    })
    this.unwrap(result)
    return result.value
  }

  /** List the per-file draft scratch tree. ACL identical to saveDraft. */
  async listDraftFiles(userId: string, sourceId: string): Promise<DraftFileNode[]> {
    await this.resolveNativeSourceForWrite(userId, sourceId)
    const result = await scsListDraftTree(sourceId)
    this.unwrap(result)
    return result.value.entries
  }

  async writeDraftFile(args: {
    userId: string
    sourceId: string
    path: string
    body: ReadableStream<Uint8Array>
    contentLength?: number
    signal?: AbortSignal
  }): Promise<{ ok: true; byte_count: number }> {
    await this.resolveNativeSourceForWrite(args.userId, args.sourceId)
    const result = await scsPutDraftFile({
      sourceId: args.sourceId,
      path: args.path,
      body: args.body,
      contentLength: args.contentLength,
      signal: args.signal,
    })
    this.unwrap(result)
    return result.value
  }

  async deleteDraftFile(userId: string, sourceId: string, path: string): Promise<void> {
    await this.resolveNativeSourceForWrite(userId, sourceId)
    const result = await scsDeleteDraftFile(sourceId, path)
    this.unwrap(result)
  }

  async discardDraft(userId: string, sourceId: string): Promise<void> {
    const source = await this.getSource(userId, sourceId)
    if (source.kind !== 'native') return
    const result = await scsDeleteDraft(sourceId)
    this.unwrap(result)
  }

  // ─── publish / sync / version ops ────────────────────────────────────────

  async publishDraft(
    userId: string,
    skillId: string,
    note?: string,
  ): Promise<{ skill: SkillMeta; version: SkillVersion }> {
    // Owner OR editor — publishing is the editor-write completion step
    // (pre-p3 PUT /:name re-upload performed pack + publish atomically).
    const skill = await this.repo.getSkillForUser(skillId, userId)
    if (!skill) throw new SkillNotFoundError()
    if (skill.my_permission !== 'owner' && skill.my_permission !== 'editor')
      throw new SkillNotFoundError()
    const result = await scsPublishSkill(skillId, { published_by: userId, note })
    this.unwrap(result)
    // Push to dependent workspaces so they pick up the new active version.
    await this.notifyAffectedWorkspaces(skillId)
    return result.value
  }

  async syncSource(userId: string, sourceId: string, token?: string): Promise<SyncResult> {
    const source = await this.getSource(userId, sourceId)
    if (source.kind !== 'git') throw new InvalidInputError('Only git sources can sync')
    const result = await scsSyncSource(sourceId, { token, published_by: userId })
    this.unwrap(result)
    // Notify the union of dependent workspaces for any skill whose
    // active version actually changed. Skipping unchanged skills keeps
    // hot reloads quiet when sync is a no-op.
    const changed = result.value.results.filter((r) => r.changed)
    await Promise.all(changed.map((r) => this.notifyAffectedWorkspaces(r.skill_id)))
    return result.value
  }

  async setActiveVersion(
    userId: string,
    skillId: string,
    versionId: string,
  ): Promise<{ skill: SkillMeta }> {
    const skill = await this.repo.getSkillForUser(skillId, userId)
    if (!skill || !skill.is_owner) throw new SkillNotFoundError()
    const result = await scsSetActiveVersion(skillId, versionId)
    this.unwrap(result)
    await this.notifyAffectedWorkspaces(skillId)
    return result.value
  }

  // ─── metadata writes ─────────────────────────────────────────────────────

  async patchMeta(input: PatchMetaInput): Promise<SkillWithAccess> {
    const existing = await this.repo.getSkillForUser(input.skillId, input.userId)
    if (!existing) throw new SkillNotFoundError()
    const isOwner = existing.is_owner
    const isEditor = existing.my_permission === 'editor'
    if (!isOwner && !isEditor) throw new NotAllowedError()

    if (!isOwner && (input.visibility !== undefined || input.grants !== undefined)) {
      throw new NotAllowedError('Only the owner can change visibility or grants')
    }

    // Rename is owner-only: the name keys the mounted directory in every
    // dependent workspace, so an editor rename would ripple far beyond the
    // content-edit rights they were granted.
    let nextName: string | undefined
    if (input.name !== undefined) {
      if (!isOwner) throw new NotAllowedError('Only the owner can rename a skill')
      const trimmed = input.name.trim()
      if (!trimmed) throw new InvalidInputError('Skill name cannot be empty')
      if (trimmed !== existing.name) nextName = trimmed
    }

    const nextVisibility = input.visibility
    const effectiveVisibility = nextVisibility ?? existing.visibility
    const nextGrants = input.grants

    // Narrowing visibility (public→team, public→private, team→private) can
    // strip access from other users' workspaces that currently mount this
    // skill. Block it while any such workspace exists. We only surface the
    // count — not which workspaces / whose — to respect the user boundary.
    if (
      isOwner &&
      nextVisibility !== undefined &&
      VISIBILITY_RANK[nextVisibility] < VISIBILITY_RANK[existing.visibility]
    ) {
      const count = await this.repo.countNonOwnerWorkspacesUsingSkill(input.skillId, input.userId)
      if (count > 0) {
        throw new ConflictError(
          `Cannot reduce visibility: ${count} workspace(s) owned by other users are using this skill. Please ask them to disable it first.`,
        )
      }
    }

    if (nextGrants !== undefined) {
      this.assertVisibilityGrantsShape(effectiveVisibility, nextGrants)
      await this.assertOwnTeams(input.userId, nextGrants)
    }

    // scs owns the skills row write — delegate. (`nextName` is undefined when
    // the name is unchanged, keeping the write — and the reload below — a
    // no-op for pure description/category edits.)
    const result = await scsPatchSkill(input.skillId, {
      name: nextName,
      description: input.description,
      visibility: nextVisibility,
      category: input.category,
    })
    this.unwrap(result)

    // Dependent workspaces mount the skill under a directory keyed by its
    // name — fan out a reload so running agents drop the old directory and
    // fetch the new one.
    if (nextName !== undefined) {
      await this.notifyAffectedWorkspaces(input.skillId)
    }

    if (isOwner && nextGrants !== undefined) {
      await this.repo.setSkillGrants(input.skillId, nextGrants, input.userId)
    } else if (isOwner && nextVisibility !== undefined && nextVisibility !== 'team') {
      await this.repo.setSkillGrants(input.skillId, [], input.userId)
    }

    const updated = await this.repo.getSkillForUser(input.skillId, input.userId)
    if (!updated) {
      throw new Error(
        `scsPatchSkill succeeded but getSkillForUser returned null for ${input.skillId}`,
      )
    }
    return updated
  }

  /**
   * Delete a skill. cp pre-checks the RESTRICT blockers (workspace_skills,
   * template_version_skills) and throws ConflictError if anything still
   * references this skill — the user has to detach first. After the check
   * passes, scs deletes (CASCADE versions, SET NULL active, CASCADE
   * skill_grants).
   *
   * Note: no workspace-reload broadcast on success. The blocker check
   * guarantees zero workspace rows reference the skill at delete time, so
   * there is nothing to reload. (Pre-p3 we cascade-detached and broadcast;
   * p3 instead refuses the cascade and lets the user detach explicitly,
   * which is where their own reloads already happen.)
   */
  /**
   * Owner-only occupancy preview for the delete / visibility-narrow flows.
   * Own workspaces come back named; other users' workspaces collapse to a
   * count so we don't leak cross-user data.
   */
  async getDependents(userId: string, skillId: string): Promise<SkillDependents> {
    const existing = await this.repo.getSkillForUser(skillId, userId)
    if (!existing) throw new SkillNotFoundError()
    if (!existing.is_owner) throw new NotAllowedError()
    return this.repo.getSkillDependents(skillId, userId)
  }

  async remove(userId: string, skillId: string): Promise<void> {
    const existing = await this.repo.getSkillForUser(skillId, userId)
    if (!existing) throw new SkillNotFoundError()
    if (!existing.is_owner) throw new NotAllowedError()

    const blockers = await this.repo.getDeleteBlockers(skillId)
    if (blockers.workspace_ids.length > 0 || blockers.template_version_ids.length > 0) {
      throw new ConflictError(this.formatDeleteBlockers(blockers))
    }

    const result = await scsDeleteSkill(skillId)
    this.unwrap(result)
  }

  /** Owner-only delete of a source. Refuses if any skill still under it. */
  async removeSource(userId: string, sourceId: string): Promise<void> {
    await this.getSource(userId, sourceId)
    const result = await scsDeleteSource(sourceId)
    this.unwrap(result)
  }

  // ─── grants ──────────────────────────────────────────────────────────────

  async listGrants(userId: string, skillId: string): Promise<SkillGrantRow[]> {
    const existing = await this.repo.getSkillForUser(skillId, userId)
    if (!existing || !existing.is_owner) throw new SkillNotFoundError()
    return this.repo.listSkillGrants(skillId)
  }

  async setGrants(
    userId: string,
    skillId: string,
    grants: SkillGrantInput[],
  ): Promise<SkillGrantRow[]> {
    const existing = await this.repo.getSkillForUser(skillId, userId)
    if (!existing || !existing.is_owner) throw new SkillNotFoundError()
    if (existing.visibility !== 'team' && grants.length > 0) {
      throw new InvalidInputError('grants only allowed when visibility=team')
    }
    await this.assertOwnTeams(userId, grants)
    await this.repo.setSkillGrants(skillId, grants, userId)
    return this.repo.listSkillGrants(skillId)
  }

  // ─── public shares (local-agent registry) ────────────────────────────────
  //
  // Owner-only, like grants: a share hands the skill to anyone holding the
  // URL, so it is a wider act than the `editor` permission is meant to cover.
  // Non-owners get 404 rather than 403 so the surface doesn't confirm that a
  // skill they can read is shareable by someone else.

  async listExports(userId: string, skillId: string): Promise<SkillExportToken[]> {
    const existing = await this.repo.getSkillForUser(skillId, userId)
    if (!existing || !existing.is_owner) throw new SkillNotFoundError()
    return listSkillExportTokens(skillId)
  }

  /**
   * Mint a share. `ttlDays === null` means permanent; omitting it applies the
   * default window. There is no renew — see createSkillExportToken.
   *
   * The slug is derived from the skill name when that produces something the
   * discovery protocol accepts. When it doesn't — a CJK or emoji name leaves
   * nothing behind — the caller must supply one. We deliberately don't invent
   * an id-derived fallback: the slug becomes a directory name on the
   * installer's machine, and `skill-3f2a1b9c` is a poor thing to hand someone.
   */
  async createExport(
    userId: string,
    skillId: string,
    opts: { slug?: string; ttlDays?: number | null; label?: string } = {},
  ): Promise<SkillExportToken> {
    const existing = await this.repo.getSkillForUser(skillId, userId)
    if (!existing || !existing.is_owner) throw new SkillNotFoundError()
    if (!existing.active_version_id) {
      throw new InvalidInputError('Publish the skill before sharing it')
    }

    // Stated in full on both failure paths — the UI surfaces these verbatim
    // when prompting for a slug.
    const rules = `${MAX_SKILL_SLUG_LENGTH} lowercase letters, digits, and single hyphens (not leading or trailing)`

    let slug: string
    if (opts.slug !== undefined) {
      // Explicit input is validated, never silently repaired — a user who
      // typed a name should get it or be told why not.
      if (!isValidSkillSlug(opts.slug)) {
        throw new InvalidInputError(`Invalid slug "${opts.slug}": use 1-${rules}`)
      }
      slug = opts.slug
    } else {
      const derived = deriveSkillSlug(existing.name)
      if (!derived) {
        throw new InvalidInputError(
          `Cannot derive a share name from "${existing.name}" — provide a slug: 1-${rules}`,
        )
      }
      slug = derived
    }

    const ttlDays = opts.ttlDays === undefined ? DEFAULT_EXPORT_TTL_DAYS : opts.ttlDays
    return createSkillExportToken(skillId, userId, slug, ttlDays, opts.label ?? '')
  }

  async revokeExport(userId: string, skillId: string, token: string): Promise<boolean> {
    const existing = await this.repo.getSkillForUser(skillId, userId)
    if (!existing || !existing.is_owner) throw new SkillNotFoundError()
    return deleteSkillExportToken(skillId, token)
  }

  // ─── workspace ↔ skill ───────────────────────────────────────────────────

  async attachToWorkspace(workspaceId: string, skillIds: string[]): Promise<{ reloaded: boolean }> {
    const workspace = await this.deps.getWorkspaceForAttach(workspaceId)
    if (!workspace) throw new Error('workspace not found')

    if (skillIds.length > 0) {
      const invisible = await this.repo.findSkillIdsNotVisibleToUser(skillIds, workspace.user_id)
      if (invisible.length > 0) {
        throw new Error(`skills not visible to workspace owner: ${invisible.join(', ')}`)
      }
    }

    await this.repo.setWorkspaceSkills(workspaceId, skillIds)

    if (workspace.status !== 'running') return { reloaded: false }
    const reloaded = await this.notifier.reload(workspaceId, ['skills']).catch(() => false)
    return { reloaded }
  }

  // ─── helpers exposed for routes that perform writes themselves ───────────

  validateGrantsShape(visibility: SkillVisibility, grants: SkillGrantInput[]): void {
    this.assertVisibilityGrantsShape(visibility, grants)
  }

  validateOwnTeams(userId: string, grants: SkillGrantInput[]): Promise<void> {
    return this.assertOwnTeams(userId, grants)
  }

  async reloadDependentWorkspaces(skillId: string): Promise<void> {
    return this.notifyAffectedWorkspaces(skillId)
  }

  // ─── internal helpers ────────────────────────────────────────────────────

  private assertVisibilityGrantsShape(
    visibility: SkillVisibility,
    grants: SkillGrantInput[],
  ): void {
    if (visibility === 'team' && grants.length === 0) {
      throw new InvalidInputError('visibility=team requires at least one grant')
    }
    if (visibility !== 'team' && grants.length > 0) {
      throw new InvalidInputError('grants only allowed when visibility=team')
    }
  }

  private async assertOwnTeams(userId: string, grants: SkillGrantInput[]): Promise<void> {
    for (const g of grants) {
      const member = await this.deps.isTeamMember(g.team_id, userId)
      if (!member) throw new InvalidInputError(`Team ${g.team_id} not accessible`)
    }
  }

  // Defer the per-workspace reload fanout to the background queue instead of
  // blocking the write on every dependent agent's reload RTT. The scheduler
  // worker calls back into `/_cp/skills/:id/reload-fanout` to do the actual
  // fanout. Enqueue reads the *current* active version at execution time, so
  // coalescing a burst of writes per skill is safe.
  private notifyAffectedWorkspaces(skillId: string): Promise<void> {
    return this.reloadQueue.enqueue(skillId)
  }

  /**
   * Translate a low-level scs error to the matching SkillError. Routes can
   * still catch the generic `Error` to surface 502 on transport failures.
   */
  private unwrap<T>(result: ScsResult<T>): asserts result is { ok: true; value: T } {
    if (result.ok) return
    if (result.status === 404) throw new SkillNotFoundError(result.error)
    if (result.status === 409) throw new ConflictError(result.error)
    if (result.status === 400) throw new InvalidInputError(result.error, result.body)
    throw new Error(`scs ${result.status}: ${result.error}`)
  }

  private formatDeleteBlockers(blockers: SkillDeleteBlockers): string {
    const parts: string[] = []
    if (blockers.workspace_ids.length > 0) {
      parts.push(`${blockers.workspace_ids.length} workspace(s)`)
    }
    if (blockers.template_version_ids.length > 0) {
      parts.push(`${blockers.template_version_ids.length} template version(s)`)
    }
    return `Cannot delete skill: still in use by ${parts.join(' and ')}. Detach first.`
  }
}
