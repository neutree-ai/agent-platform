/**
 * Shared skill management for all NAP agent types.
 *
 * Uses dependency injection for all I/O — fetch, filesystem, shell — so the
 * module is trivially testable without mocking node builtins.
 */

// ── DI interfaces ──

/** Minimal fetch: only what SkillManager needs. */
export interface FetchResponse {
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  json(): Promise<unknown>
  arrayBuffer(): Promise<ArrayBuffer>
}

export interface FetchInit {
  headers?: Record<string, string>
}

export interface Fetcher {
  (url: string, init?: FetchInit): Promise<FetchResponse>
}

/** Filesystem operations used by SkillManager. */
export interface Fs {
  exists(path: string): boolean
  mkdir(path: string): Promise<void>
  writeFile(path: string, data: string | Buffer): Promise<void>
  readFile(path: string): Promise<Buffer>
  rm(path: string): Promise<void>
  /** Read immediate children names (like readdir). */
  readdir(path: string): Promise<string[]>
  /** Atomic move; required for staging-then-swap during load. */
  rename(from: string, to: string): Promise<void>
}

/** Shell execution — used only for tar pack/unpack. */
export interface Shell {
  exec(cmd: string, args: string[]): Promise<void>
}

// ── Options ──

export interface SkillManagerOptions {
  /** Control-plane base URL. */
  cpUrl: string
  /** Current workspace ID. */
  workspaceId: string
  /**
   * Agent-specific skills directory on NFS.
   * e.g. `/workspace/.claude/skills` or `~/.codex/skills`
   */
  skillsDir: string
  /**
   * Local tmpfs directory for extraction (avoids NFS small-file overhead).
   * Defaults to `/tmp`.
   */
  localBase?: string
  /**
   * Persistent (NFS-backed) base directory for *draft* skills — unpublished
   * edits that must survive pod rebuilds. When set, a draft's content lives at
   * `draftBase/skill-{name}` (not tmpfs), so it is not lost when /tmp is wiped.
   * Must be distinct from `localBase` and outside the dufs-served skills tree.
   * When unset, drafts fall back to tmpfs (legacy behaviour: lost on rebuild).
   */
  draftBase?: string
  /**
   * Whether to symlink skillsDir/{name} → localBase/skill-{name}.
   * true for claude-code & codex (NFS workspace), false if skillsDir is already local.
   */
  useSymlink?: boolean
  /**
   * Path prefix for the files browser (relative to workspace root).
   * e.g. `/.claude/skills` or `/.codex/skills`
   * Used by the frontend to construct dufs file browser URLs.
   */
  filesBrowsePath?: string

  // DI
  fetch: Fetcher
  fs: Fs
  shell: Shell
}

// ── Result types ──

export interface LoadResult {
  /** Skills now present on disk (downloaded + extracted, or in editing mode). */
  loaded: string[]
  /** Skills whose download exhausted retries; existing destDir preserved. */
  failed: string[]
  /** Skills skipped because of an active .editing lock. */
  editing: string[]
}

// ── Constants ──

const LOCK_FILE = '.editing'

/**
 * Skill names owned by the platform. These are stamped onto the agent
 * filesystem by `installPlatformSkill()` at startup and must never go through
 * the user-editable lifecycle (createDraft / edit / pack / remove). CP mirrors
 * the same list in `services/db/skills.ts`.
 */
export const RESERVED_SKILL_NAMES: ReadonlySet<string> = new Set(['__platform__'])

function assertNotReserved(name: string): void {
  if (RESERVED_SKILL_NAMES.has(name)) {
    throw new Error(`Skill name "${name}" is reserved for platform use`)
  }
}

const SKILL_MD_TEMPLATE = `---
name: {{name}}
description: ""
---

# {{name}}

Instructions go here.
`

// ── SkillManager ──

export class SkillManager {
  private cpUrl: string
  private workspaceId: string
  private skillsDir: string
  private localBase: string
  private draftBase: string | null
  private useSymlink: boolean
  private fetch: Fetcher
  private fs: Fs
  private shell: Shell
  private _filesBrowsePath: string
  /** Skills the workspace owner can edit (owner match or no owner). */
  private editableSkills = new Set<string>()
  /** Skills imported from git. */
  private gitSourceSkills = new Set<string>()
  /** All skills known to CP (used to distinguish drafts from CP-registered skills). */
  private _knownSkills = new Set<string>()
  /**
   * Display-name → skill UUID, populated when we list enabled skills. p3
   * keys the cp download URL on UUID since names are no longer globally
   * unique. The filesystem still uses the display name (user-facing dir).
   */
  private skillIds = new Map<string, string>()

  constructor(opts: SkillManagerOptions) {
    this.cpUrl = opts.cpUrl
    this.workspaceId = opts.workspaceId
    this.skillsDir = opts.skillsDir
    this.localBase = opts.localBase ?? '/tmp'
    this.draftBase = opts.draftBase ?? null
    this.useSymlink = opts.useSymlink ?? true
    this._filesBrowsePath = opts.filesBrowsePath ?? '/.claude/skills'
    this.fetch = opts.fetch
    this.fs = opts.fs
    this.shell = opts.shell
  }

  /**
   * Content directory for a skill. Drafts (unpublished edits) live on the
   * persistent draftBase so they survive pod rebuilds; published skills live on
   * tmpfs (localBase) and are re-downloaded from CP after a wipe. The draftBase
   * probe is a stat on an NFS path that outlives the pod, so this stays correct
   * across rebuilds without any in-memory state to reconstruct.
   */
  private localDir(name: string): string {
    const db = this.draftBase
    if (db && this.fs.exists(`${db}/skill-${name}`)) {
      return `${db}/skill-${name}`
    }
    return `${this.localBase}/skill-${name}`
  }

  /** A skill is a (persistent) draft iff its content dir exists under draftBase. */
  private isDraft(name: string): boolean {
    const db = this.draftBase
    return db != null && this.fs.exists(`${db}/skill-${name}`)
  }

  /** Persistent draft content dir for a skill (caller must ensure draftBase is set). */
  private draftDir(name: string): string {
    return `${this.draftBase}/skill-${name}`
  }

  /** Lock file path for a skill. */
  private lockPath(name: string): string {
    return `${this.localDir(name)}/${LOCK_FILE}`
  }

  /** Destination directory (under skillsDir on NFS). */
  private destDir(name: string): string {
    return `${this.skillsDir}/${name}`
  }

  /**
   * Sidecar file recording the ETag of the currently-extracted version. Kept
   * beside (not inside) the local extraction dir so it shares the same /tmp
   * lifetime as the content it describes — both vanish on pod restart, keeping
   * "we have content" and "we know its hash" consistent — and never shows up
   * inside the skill directory the agent sees.
   */
  private etagPath(name: string): string {
    return `${this.localBase}/.skill-etag-${name}`
  }

  /**
   * Provenance marker: present iff this skill was downloaded from CP (i.e. it's
   * a managed skill, not a local draft). Orphan cleanup deletes a no-longer-
   * enabled skill ONLY when this marker is present — a draft (never downloaded,
   * never marked) is therefore never auto-removed. Lives beside the extraction
   * dir (same /tmp lifetime, never inside the skill the agent/file-browser sees,
   * never inside dufs's served tree).
   */
  private managedPath(name: string): string {
    return `${this.localBase}/.skill-managed-${name}`
  }

  // ── Query ──

  /** Check if a skill is currently being edited. */
  isEditing(name: string): boolean {
    return this.fs.exists(this.lockPath(name))
  }

  /** Check if the workspace owner can edit this skill. Draft skills (not in CP) are always editable. */
  isEditable(name: string): boolean {
    // If skill was loaded from CP, check the editable set.
    // If not in the set at all (draft, created locally), it's editable by default.
    return this.editableSkills.has(name) || !this._knownSkills.has(name)
  }

  /** Check if a skill was imported from git. */
  isGitSource(name: string): boolean {
    return this.gitSourceSkills.has(name)
  }

  /** Path prefix for constructing file browser URLs. */
  get filesBrowsePath(): string {
    return this._filesBrowsePath
  }

  /**
   * List locally extracted skills. Filters out dangling symlinks (target gone)
   * and platform-managed skills (those are invisible to the user-facing editor).
   */
  async listLocal(): Promise<string[]> {
    try {
      const entries = await this.fs.readdir(this.skillsDir)
      const userVisible = entries.filter((name) => !RESERVED_SKILL_NAMES.has(name))
      if (!this.useSymlink) return userVisible
      // In symlink mode, entries point at localBase/skill-{name}. After pod
      // restart /tmp is wiped, leaving dangling symlinks for any skill whose
      // owning workspace no longer enables it. Filter those out.
      return userVisible.filter((name) => this.fs.exists(this.localDir(name)))
    } catch {
      return []
    }
  }

  // ── Load (download from CP → extract) ──

  /**
   * Load all enabled skills for the workspace.
   *
   * Per-skill atomic: download into staging → swap into place only on success.
   * A skill that exhausts retries leaves its existing destDir / localDir
   * untouched, so a transient CP outage cannot empty out a previously valid
   * skill directory. Caller distinguishes boot-time vs. runtime reload and
   * decides what to do with the failed list (boot: exit and let kubelet
   * restart; reload: log and keep serving with old state).
   *
   * Skills with an active .editing lock are skipped (reported under editing).
   */
  async load(): Promise<LoadResult> {
    // 1. Fetch enabled skill names for this workspace
    const listResp = await this.fetch(
      `${this.cpUrl}/_cp/workspaces/${this.workspaceId}/skills`,
    )
    if (!listResp.ok) {
      throw new Error(`Skills list fetch failed: ${listResp.status}`)
    }
    const { skills: skillEntries } = (await listResp.json()) as {
      skills:
        | string[]
        | { id?: string; name: string; editable?: boolean; gitSource?: boolean }[]
    }

    // Normalize: support legacy (string[]) and p3 ({id,name,editable,gitSource}[]).
    // p3 entries carry `id`, which we track separately for cp download URLs.
    const skills: string[] = []
    this.editableSkills.clear()
    this.gitSourceSkills.clear()
    this._knownSkills.clear()
    this.skillIds.clear()
    for (const entry of skillEntries) {
      if (typeof entry === 'string') {
        skills.push(entry)
        this._knownSkills.add(entry)
        this.editableSkills.add(entry) // legacy: assume editable
      } else {
        skills.push(entry.name)
        this._knownSkills.add(entry.name)
        if (entry.id) this.skillIds.set(entry.name, entry.id)
        if (entry.editable !== false) this.editableSkills.add(entry.name)
        if (entry.gitSource) this.gitSourceSkills.add(entry.name)
      }
    }

    // 2. Ensure skillsDir exists
    await this.fs.mkdir(this.skillsDir)

    // 3. Pre-sweep dangling symlinks on the NFS skillsDir.
    // After a pod restart /tmp is wiped, leaving every dest → localBase symlink
    // dangling. Removing them up front means a download failure later won't
    // leave a confusingly broken entry on disk; either we'll replace it with a
    // working extraction or it stays missing.
    if (this.useSymlink) {
      let entries: string[] = []
      try {
        entries = await this.fs.readdir(this.skillsDir)
      } catch {
        // Directory missing — nothing to sweep
      }
      for (const name of entries) {
        if (name.startsWith('.')) continue
        if (RESERVED_SKILL_NAMES.has(name)) continue
        if (this.isEditing(name)) continue
        if (this.fs.exists(this.localDir(name))) continue
        try {
          await this.fs.rm(this.destDir(name))
        } catch {
          // Best-effort
        }
      }
    }

    // 4. Download and atomically swap each enabled skill. Skills whose ETag
    // still matches what we have on disk are skipped (no download, no extract).
    // Either way a present, enabled skill gets its `.managed` provenance marker
    // (re)affirmed — including the unchanged path, so that when it's later
    // disabled the orphan sweep can recognize it as managed and clean it up.
    const loaded: string[] = []
    const failed: string[] = []
    const editing: string[] = []
    let unchanged = 0
    await Promise.all(
      skills.map(async (name) => {
        if (this.isEditing(name)) {
          editing.push(name)
          return
        }

        // Enabled + not editing, yet a persistent draft dir lingers → it was
        // published (or replaced) elsewhere. Reclaim it so we re-materialise the
        // active version on tmpfs instead of serving the stale draft off NFS.
        if (this.draftBase && this.isDraft(name)) {
          await this.fs.rm(this.draftDir(name))
          await this.fs.rm(this.destDir(name))
        }

        const res = await this.downloadWithRetry(name)
        if (res.kind === 'failed') {
          // Retries exhausted — preserve existing destDir/localDir state.
          failed.push(name)
          return
        }
        if (res.kind === 'unchanged') {
          // Already on disk at the active version — nothing to do but reaffirm
          // the provenance marker.
          await this.markManaged(name)
          unchanged++
          loaded.push(name)
          return
        }

        try {
          await this.extractAtomic(name, res.buf, res.etag)
          await this.markManaged(name)
          loaded.push(name)
        } catch (e) {
          console.error(
            `[skills] extract_failed name=${name} error=${(e as Error).message}`,
          )
          failed.push(name)
        }
      }),
    )

    // 5. Cleanup orphans: managed skills (downloaded from CP, carrying a
    // `.managed` marker) that are no longer enabled for this workspace. We
    // drive the loop off what's actually on disk — not the global registry —
    // and delete ONLY entries with the provenance marker. Local drafts (never
    // downloaded, never marked) are therefore never auto-removed; the worst a
    // missing marker can do is leave a disabled skill on disk (harmless, and
    // self-healing on the next restart's pre-sweep).
    const enabledSet = new Set(skills)
    let onDisk: string[] = []
    try {
      onDisk = await this.fs.readdir(this.skillsDir)
    } catch {
      // Directory missing — nothing to clean up
    }
    for (const name of onDisk) {
      if (name.startsWith('.')) continue
      if (RESERVED_SKILL_NAMES.has(name)) continue
      if (enabledSet.has(name)) continue
      if (this.isEditing(name)) continue
      if (!this.fs.exists(this.managedPath(name))) continue // draft / unknown — keep
      try {
        await this.fs.rm(this.destDir(name))
        await this.fs.rm(this.localDir(name))
        await this.fs.rm(this.etagPath(name))
        await this.fs.rm(this.managedPath(name))
      } catch {
        // Best-effort
      }
    }

    console.log(
      `[skills] load_summary loaded=${loaded.length} unchanged=${unchanged} failed=${failed.length} editing=${editing.length}` +
        (failed.length > 0 ? ` failed_names=${failed.join(',')}` : ''),
    )

    return { loaded, failed, editing }
  }

  /** Best-effort stamp of the `.managed` provenance marker for a CP skill. */
  private async markManaged(name: string): Promise<void> {
    try {
      if (!this.fs.exists(this.managedPath(name))) {
        await this.fs.writeFile(this.managedPath(name), '')
      }
    } catch {
      // Best-effort: a missing marker only risks leaving a disabled skill on
      // disk later, never deleting a draft.
    }
  }

  /**
   * Read the ETag of the version currently extracted for a skill, but only when
   * its content is actually present and reachable. Returns null otherwise so the
   * caller does an unconditional download rather than risk skipping a skill whose
   * files are missing (e.g. dangling symlink after a /tmp wipe).
   */
  private async readKnownEtag(name: string): Promise<string | null> {
    if (!this.fs.exists(this.localDir(name))) return null
    if (this.useSymlink && !this.fs.exists(this.destDir(name))) return null
    try {
      const raw = (await this.fs.readFile(this.etagPath(name))).toString().trim()
      return raw || null
    } catch {
      return null
    }
  }

  /**
   * Download with bounded retries + exponential backoff. When we already have
   * the skill on disk, sends `If-None-Match` so an unchanged active version
   * comes back as 304 (`{kind:'unchanged'}`) instead of re-streaming + re-
   * extracting the package. Returns `{kind:'failed'}` on exhaustion.
   */
  private async downloadWithRetry(name: string): Promise<
    | { kind: 'ok'; buf: Buffer; etag: string | null }
    | { kind: 'unchanged' }
    | { kind: 'failed' }
  > {
    const maxAttempts = 3
    const backoffMs = [500, 1500] // gap between attempt 1→2, 2→3
    // p3: cp's download path is `/_cp/skills/:id/package`; the name itself
    // is no longer unique. We resolved id at list time. If a caller invokes
    // download for a name we never listed (e.g. a CLI-driven probe), fall
    // back to the legacy by-name path so existing tooling doesn't break;
    // cp will 404 and we'll surface that as failed download.
    const id = this.skillIds.get(name)
    const url = id
      ? `${this.cpUrl}/_cp/skills/${id}/package`
      : `${this.cpUrl}/_cp/skills/${name}`
    const knownEtag = await this.readKnownEtag(name)
    const init: FetchInit | undefined = knownEtag
      ? { headers: { 'If-None-Match': knownEtag } }
      : undefined
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const resp = await this.fetch(url, init)
        if (resp.status === 304) {
          return { kind: 'unchanged' }
        }
        if (resp.ok) {
          return {
            kind: 'ok',
            buf: Buffer.from(await resp.arrayBuffer()),
            etag: resp.headers.get('ETag'),
          }
        }
        console.error(
          `[skills] download_failed name=${name} attempt=${attempt}/${maxAttempts} status=${resp.status}`,
        )
      } catch (e) {
        console.error(
          `[skills] download_error name=${name} attempt=${attempt}/${maxAttempts} error=${(e as Error).message}`,
        )
      }
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, backoffMs[attempt - 1]))
      }
    }
    console.error(`[skills] download_exhausted name=${name} attempts=${maxAttempts}`)
    return { kind: 'failed' }
  }

  /**
   * Extract tar.gz into a staging dir, then atomically swap into localDir.
   * On any failure (tar error, swap error) the existing localDir is
   * preserved — caller treats this as a per-skill failure.
   */
  private async extractAtomic(name: string, buf: Buffer, etag: string | null): Promise<void> {
    const local = this.localDir(name)
    const dest = this.destDir(name)
    const staging = `${local}.staging-${process.pid}-${Date.now()}`

    // Sweep leaked staging dirs for this skill before extracting. Each staging
    // dir carries a unique pid/timestamp suffix, so the old single rm of the
    // current name never caught siblings left behind by a crashed or concurrent
    // extract — they accumulated in localBase (hundreds were observed in prod).
    // Clear them all, then stage fresh.
    try {
      const prefix = `skill-${name}.staging-`
      const entries = await this.fs.readdir(this.localBase)
      await Promise.all(
        entries
          .filter((e) => e.startsWith(prefix))
          .map((e) => this.fs.rm(`${this.localBase}/${e}`)),
      )
    } catch {
      // Best-effort
    }
    await this.fs.mkdir(staging)
    const tmpFile = `${staging}/.skill.tar.gz`
    try {
      await this.fs.writeFile(tmpFile, buf)
      await this.shell.exec('tar', ['xzf', tmpFile, '-C', staging])
      await this.fs.rm(tmpFile)
    } catch (e) {
      await this.fs.rm(staging).catch(() => {})
      throw e
    }

    // Atomic swap: rm old localDir, rename staging into its place. The window
    // between rm and rename is the only non-atomic moment; if the process dies
    // here, the next load() will re-extract over the missing dir.
    await this.fs.rm(local)
    await this.fs.rename(staging, local)

    // Refresh symlink (idempotent under ln -sfn would be nicer, but our Shell
    // interface doesn't model flags; rm-then-ln is what we have).
    if (this.useSymlink) {
      await this.fs.rm(dest)
      await this.shell.exec('ln', ['-s', local, dest])
    }

    // Record the version we just extracted so the next load can skip an
    // unchanged download. Best-effort: a missing/stale sidecar only costs one
    // extra full download next time. Written last so it's never ahead of the
    // content it describes. If scs didn't send an ETag (older deploy), drop any
    // stale sidecar so we don't send a bogus If-None-Match.
    try {
      if (etag) {
        await this.fs.writeFile(this.etagPath(name), etag)
      } else {
        await this.fs.rm(this.etagPath(name))
      }
    } catch {
      // Best-effort
    }
  }

  // ── Editing ──

  /** Enter editing mode for a skill. Creates .editing lockfile. */
  async startEditing(name: string): Promise<void> {
    assertNotReserved(name)
    // Use isEditable, not editableSkills.has — local drafts (created via
    // skill_create_draft, not yet in CP) aren't in the editable set but
    // are always editable. isEditable falls back to "unknown to CP =
    // draft = editable".
    if (!this.isEditable(name)) {
      throw new Error(`Not allowed to edit skill: ${name}`)
    }
    const cur = this.localDir(name)
    if (!this.fs.exists(cur)) {
      throw new Error(`Skill not found locally: ${name}`)
    }
    // Promote a published skill (content on tmpfs) into a persistent draft so
    // the edit isn't lost on pod rebuild. `cp -a` preserves mode bits, so
    // executable scripts in the skill keep their +x. No-op if it's already a
    // draft or draftBase isn't configured.
    if (this.draftBase && !this.isDraft(name)) {
      const draft = this.draftDir(name)
      await this.fs.rm(draft)
      await this.fs.mkdir(draft)
      await this.shell.exec('cp', ['-a', `${cur}/.`, draft])
      if (this.useSymlink) {
        await this.fs.rm(this.destDir(name))
        await this.shell.exec('ln', ['-s', draft, this.destDir(name)])
      }
      await this.fs.rm(cur)
    }
    await this.fs.writeFile(this.lockPath(name), '')
  }

  /** Exit editing mode. Removes .editing lockfile. */
  async stopEditing(name: string): Promise<void> {
    try {
      await this.fs.rm(this.lockPath(name))
    } catch {
      // Already removed — fine
    }
  }

  // ── Create draft ──

  /** Create a new empty skill with a template SKILL.md. */
  async createDraft(name: string): Promise<void> {
    assertNotReserved(name)
    // A brand-new skill is a draft from birth: place its content on the
    // persistent draftBase (when configured) so it survives a pod rebuild
    // before it is ever published. localDir() can't be used here because it
    // probes for an existing draft dir that we are about to create.
    const local = this.draftBase ? this.draftDir(name) : this.localDir(name)
    const dest = this.destDir(name)

    await this.fs.rm(local)
    await this.fs.mkdir(local)

    const content = SKILL_MD_TEMPLATE.replaceAll('{{name}}', name)
    await this.fs.writeFile(`${local}/SKILL.md`, content)

    if (this.useSymlink) {
      await this.fs.rm(dest)
      await this.shell.exec('ln', ['-s', local, dest])
    }

    // Immediately enter editing mode
    await this.fs.writeFile(this.lockPath(name), '')
  }

  // ── Remove ──

  /**
   * Remove a skill locally: unlink the symlink under skillsDir and remove
   * the extracted /tmp/skill-{name} cache. The caller is responsible for
   * also disabling the skill in the workspace config on CP.
   */
  async remove(name: string): Promise<void> {
    assertNotReserved(name)
    await this.fs.rm(this.destDir(name))
    await this.fs.rm(`${this.localBase}/skill-${name}`)
    if (this.draftBase) await this.fs.rm(this.draftDir(name))
    await this.fs.rm(this.etagPath(name))
    await this.fs.rm(this.managedPath(name))
    this.editableSkills.delete(name)
    this.gitSourceSkills.delete(name)
    this._knownSkills.delete(name)
  }

  // ── Pack (for publish) ──

  /**
   * Pack the local skill directory into a tar.gz buffer.
   * The caller is responsible for uploading to the control plane and
   * calling stopEditing() after a successful upload.
   */
  // ── Platform skill ──

  /**
   * Stamp the platform-managed `__platform__` skill onto disk. Caller passes a
   * map of relative paths → content; SkillManager owns the lifecycle:
   *
   *   1. Sweep any prior install (chmod u+w to undo prior readonly, then rm)
   *      so OSS bumps refresh cleanly.
   *   2. Write each file (parent dirs first).
   *   3. Lock the entire tree readonly via `chmod -R a-w` — files end at 0444,
   *      directories at 0555. Defense in depth on top of the route-level
   *      reserved-name guards.
   *
   * The skill name is hard-coded (`__platform__`) — intentionally non-
   * parametric so the protection model stays unambiguous. Caller renders any
   * templating (Mustache, etc.) and passes final content strings.
   */
  async installPlatformSkill(files: Record<string, string>): Promise<void> {
    const name = '__platform__'
    const dest = this.destDir(name)

    // Undo readonly from a previous install (no-op if first run).
    try {
      await this.shell.exec('chmod', ['-R', 'u+w', dest])
    } catch {
      // Path may not exist yet — fine.
    }
    await this.fs.rm(dest)
    await this.fs.mkdir(dest)

    // Write parent dirs first so nested paths land cleanly.
    const sorted = Object.entries(files).sort(
      ([a], [b]) => a.split('/').length - b.split('/').length,
    )
    for (const [rel, content] of sorted) {
      if (rel.startsWith('/') || rel.split('/').includes('..')) {
        throw new Error(`Invalid platform skill path: ${rel}`)
      }
      const slash = rel.lastIndexOf('/')
      if (slash !== -1) {
        await this.fs.mkdir(`${dest}/${rel.slice(0, slash)}`)
      }
      await this.fs.writeFile(`${dest}/${rel}`, content)
    }

    // Lock down: clears write for owner/group/other on every file + dir.
    await this.shell.exec('chmod', ['-R', 'a-w', dest])
  }

  async pack(name: string): Promise<Buffer> {
    assertNotReserved(name)
    const local = this.localDir(name)
    if (!this.fs.exists(local)) {
      throw new Error(`Skill not found locally: ${name}`)
    }

    const tarFile = `${this.localBase}/skill-${name}-publish.tar.gz`
    try {
      await this.fs.rm(tarFile)
      await this.shell.exec('tar', [
        'czf', tarFile,
        '-C', local,
        '--exclude', LOCK_FILE,
        '--exclude', '.skill.tar.gz',
        '.',
      ])
      return await this.fs.readFile(tarFile)
    } finally {
      try { await this.fs.rm(tarFile) } catch {}
    }
  }
}
