/**
 * Git import / sync / scan orchestration for the p3 schema.
 *
 * Responsibilities:
 *   - `scanGit`  : pure parse of a remote tarball into candidate subpaths.
 *   - `scanTarball` : same shape for a user-uploaded tarball (no git fetch).
 *   - `importFromGit` : ensure a git source row exists, then INSERT skill +
 *                       first version (idempotent on content_hash).
 *   - `syncSource`    : re-fetch the source's repo, walk every dependent skill,
 *                       and append a new version when its repacked subpath
 *                       differs from its current active version's content_hash.
 *
 * cp resolves credentials → token → ACL upstream, then forwards bytes here.
 * The token never persists; only `credential_name` does.
 */
import {
  type SkillMeta,
  type SkillSource,
  type SkillVersion,
  findGitSource,
  findSkillByOwnerName,
  findSkillBySourceSubpath,
  getActiveVersionHash,
  getSkillById,
  getSourceById,
  insertSkill,
  insertSkillSource,
  insertVersion,
  listSkillsBySource,
  markSourceSynced,
  pool,
  setActiveVersion,
  switchSkillToGitSource,
  withTx,
} from './db'
import { UndiciGitSourceClient } from './git-source-client'
import { type ParsedGitSource, getTarballUrl, parseGitUrl } from './git-url'
import { parseFrontmatter } from './parse-frontmatter'
import { scanSkills } from './scan'
import {
  type TarEntry,
  extractEntries,
  filterSubpath,
  findSkillMd,
  repack,
  stripPrefix,
} from './skill-tar'

const gitClient = new UndiciGitSourceClient()

function maxSkillPackageBytes(): number {
  return Number(process.env.MAX_SKILL_PACKAGE_BYTES || 50 * 1024 * 1024)
}

// ── shared fetch-and-strip step ────────────────────────────────────────────

interface FetchedRepo {
  parsed: ParsedGitSource
  entries: TarEntry[] // already prefix-stripped
}

async function fetchRepo(args: {
  url: string
  type?: string
  ref?: string
  token?: string
}): Promise<{ ok: true; data: FetchedRepo } | { ok: false; status: number; error: string }> {
  let parsed: ParsedGitSource
  try {
    parsed = parseGitUrl(args.url, args.type)
  } catch (e) {
    return { ok: false, status: 400, error: (e as Error).message }
  }
  if (args.ref !== undefined) parsed.ref = args.ref || null

  const { url: tarballUrl, headers } = getTarballUrl(parsed, args.token)

  let bytes: Buffer
  const tDl = Date.now()
  try {
    bytes = await gitClient.fetchTarball(tarballUrl, headers)
  } catch (e) {
    return { ok: false, status: 502, error: (e as Error).message }
  }
  const dlMs = Date.now() - tDl
  if (bytes.byteLength === 0) {
    return { ok: false, status: 502, error: 'upstream returned empty tarball' }
  }

  const tExtract = Date.now()
  const raw = await extractEntries(bytes)
  const stripped = stripPrefix(raw)
  console.log(
    `[skills-content] fetchRepo: host=${parsed.host} repo=${parsed.owner}/${parsed.repo} ref=${parsed.ref ?? '<default>'} bytes=${bytes.byteLength} download=${dlMs}ms extract=${Date.now() - tExtract}ms entries=${stripped.length}`,
  )
  return { ok: true, data: { parsed, entries: stripped } }
}

// ── scan (pure parse) ──────────────────────────────────────────────────────

interface ScanGitArgs {
  url: string
  type?: string
  ref?: string
  token?: string
}

interface ScanGitResult {
  candidates: ReturnType<typeof scanSkills>
  requested_subpath: string | null
  commit_sha: string | null
}

export async function scanGit(
  args: ScanGitArgs,
): Promise<{ ok: true; data: ScanGitResult } | { ok: false; status: number; error: string }> {
  const fetched = await fetchRepo(args)
  if (!fetched.ok) return fetched
  const commitSha = await gitClient
    .fetchCommitSha(fetched.data.parsed, args.token)
    .catch(() => null)
  return {
    ok: true,
    data: {
      candidates: scanSkills(fetched.data.entries),
      requested_subpath: fetched.data.parsed.subpath,
      commit_sha: commitSha,
    },
  }
}

export async function scanTarballBytes(
  bytes: Buffer,
): Promise<
  | { ok: true; data: { candidates: ReturnType<typeof scanSkills> } }
  | { ok: false; status: number; error: string }
> {
  if (bytes.byteLength === 0) {
    return { ok: false, status: 400, error: 'Empty tarball.' }
  }
  let raw: TarEntry[]
  try {
    raw = await extractEntries(bytes)
  } catch (e) {
    return { ok: false, status: 400, error: (e as Error).message }
  }
  // User-packed tarballs don't have the owner-repo-sha/ wrapper.
  return { ok: true, data: { candidates: scanSkills(raw) } }
}

// ── import-from-git ────────────────────────────────────────────────────────

interface ImportFromGitArgs {
  userId: string
  url: string
  type?: string
  ref?: string
  token?: string
  credentialName?: string | null
  subpath: string
  nameOverride?: string
  descriptionOverride?: string
  visibility: 'private' | 'team' | 'public'
  category?: string | null
}

interface ImportFromGitResult {
  source: SkillSource
  skill: SkillMeta
  version: SkillVersion
}

/**
 * Idempotent on `(user_id, git_url, git_ref)`: a second import from the same
 * monorepo at the same ref reuses the existing source row. Skill creation +
 * first version happen inside one Postgres transaction.
 */
export async function importFromGit(
  args: ImportFromGitArgs,
): Promise<{ ok: true; data: ImportFromGitResult } | { ok: false; status: number; error: string }> {
  const fetched = await fetchRepo({
    url: args.url,
    type: args.type,
    ref: args.ref,
    token: args.token,
  })
  if (!fetched.ok) return fetched
  const { parsed, entries } = fetched.data

  const subpath = args.subpath ?? ''
  const scoped = filterSubpath(entries, subpath || null)
  if (scoped.length === 0) {
    return {
      ok: false,
      status: 400,
      error: subpath
        ? `Subpath "${subpath}" did not match any files in the repo.`
        : 'Tarball is empty after prefix strip.',
    }
  }
  const skillMdEntry = findSkillMd(scoped)
  if (!skillMdEntry) {
    return { ok: false, status: 400, error: 'No SKILL.md found at the requested subpath.' }
  }
  const fm = parseFrontmatter(skillMdEntry.data.toString('utf-8'))

  const name = args.nameOverride?.trim() || fm.name?.trim() || parsed.repo
  if (!name) {
    return { ok: false, status: 400, error: 'Could not resolve a skill name.' }
  }
  const description = args.descriptionOverride ?? fm.description ?? ''

  const repacked = await repack(scoped)
  if (repacked.byteLength > maxSkillPackageBytes()) {
    return {
      ok: false,
      status: 413,
      error: `Repacked skill exceeds size limit (${repacked.byteLength} bytes)`,
    }
  }

  const commitSha = await gitClient.fetchCommitSha(parsed, args.token).catch(() => null)

  // Find-or-create the source first (outside the tx — finding it is a read,
  // and a second concurrent import would race on the UNIQUE index anyway).
  // The actual insert path is wrapped in a tx + retry on unique violation.
  let source = await findGitSource(args.userId, parsed.url, parsed.ref ?? null)
  if (!source) {
    try {
      source = await insertSkillSource(pool, {
        userId: args.userId,
        kind: 'git',
        gitType: parsed.type,
        gitUrl: parsed.url,
        gitHost: parsed.host,
        gitOwner: parsed.owner,
        gitRepo: parsed.repo,
        gitRef: parsed.ref,
        credentialName: args.credentialName ?? null,
        lastCommitSha: commitSha,
      })
    } catch (e) {
      // Race: another concurrent caller inserted the same (user, url, ref).
      // Re-fetch and continue.
      const existing = await findGitSource(args.userId, parsed.url, parsed.ref ?? null)
      if (!existing) throw e
      source = existing
    }
  }

  // If a skill already exists at this (source_id, subpath), append a new
  // version instead of creating a duplicate skill. Pre-existing rows can land
  // here when the same monorepo is re-imported at the same subpath.
  const existingSkill = await findSkillBySourceSubpath(source.id, subpath)

  // Name-collision pre-flight: a skill with this `name` may already exist
  // under a DIFFERENT source (e.g. same url + different ref → new source
  // row, same name). Without this check the insert below would hit
  // `skills_user_name_uniq` and surface as an opaque 409. Return a
  // structured error so the caller can guide the user to either rename or
  // delete the existing skill first.
  if (!existingSkill) {
    const collision = await findSkillByOwnerName(args.userId, name)
    if (collision) {
      return {
        ok: false,
        status: 409,
        error: `Skill "${name}" already exists under another source for this user. To re-pin or refresh, delete the existing skill first, or import under a different name.`,
      }
    }
  }

  const result = await withTx(async (client) => {
    const ensuredSource = source!
    let skill = existingSkill
    if (!skill) {
      skill = await insertSkill(client, {
        userId: args.userId,
        sourceId: ensuredSource.id,
        name,
        subpath,
        description,
        visibility: args.visibility,
        category: args.category ?? null,
      })
    }
    const { version } = await insertVersion(client, {
      skillId: skill.id,
      sourceId: ensuredSource.id,
      package: repacked,
      commitSha,
      note: existingSkill ? 're-import from git' : 'initial import from git',
      publishedBy: args.userId,
    })
    const updated = await setActiveVersion(client, skill.id, version.id)
    return { source: ensuredSource, skill: updated ?? skill, version }
  })

  return { ok: true, data: result }
}

// ── switch source (native → git, in place) ─────────────────────────────────

interface SwitchToGitArgs {
  userId: string
  skillId: string
  url: string
  type?: string
  ref?: string
  token?: string
  credentialName?: string | null
  subpath: string
}

interface SwitchToGitResult {
  source: SkillSource
  skill: SkillMeta
  version: SkillVersion
}

/**
 * Repoint an existing native skill at a git source without changing its UUID,
 * so all mounts survive. We fetch + validate + repack the git subpath FIRST;
 * only once we hold valid bytes do we run the destructive in-tx repoint (which
 * wipes native history and drops the orphaned native source). A bad URL /
 * subpath / missing SKILL.md fails before anything is deleted.
 *
 * Idempotent on the git source via find-or-create `(user_id, url, ref)`, same
 * as importFromGit — switching a skill into a monorepo already imported reuses
 * that source row.
 */
export async function switchSourceToGit(
  args: SwitchToGitArgs,
): Promise<{ ok: true; data: SwitchToGitResult } | { ok: false; status: number; error: string }> {
  // Ownership + kind guard. cp gates ACL upstream; we re-check so the
  // destructive path can't run on someone else's or a non-native skill.
  const target = await getSkillById(args.skillId)
  if (!target || target.user_id !== args.userId) {
    return { ok: false, status: 404, error: 'Skill not found' }
  }
  if (target.source_kind !== 'native') {
    return { ok: false, status: 409, error: 'Only native skills can switch to a git source' }
  }

  const fetched = await fetchRepo({
    url: args.url,
    type: args.type,
    ref: args.ref,
    token: args.token,
  })
  if (!fetched.ok) return fetched
  const { parsed, entries } = fetched.data

  const subpath = args.subpath ?? ''
  const scoped = filterSubpath(entries, subpath || null)
  if (scoped.length === 0) {
    return {
      ok: false,
      status: 400,
      error: subpath
        ? `Subpath "${subpath}" did not match any files in the repo.`
        : 'Tarball is empty after prefix strip.',
    }
  }
  if (!findSkillMd(scoped)) {
    return { ok: false, status: 400, error: 'No SKILL.md found at the requested subpath.' }
  }

  const repacked = await repack(scoped)
  if (repacked.byteLength > maxSkillPackageBytes()) {
    return {
      ok: false,
      status: 413,
      error: `Repacked skill exceeds size limit (${repacked.byteLength} bytes)`,
    }
  }

  const commitSha = await gitClient.fetchCommitSha(parsed, args.token).catch(() => null)

  // Find-or-create the target git source (same race handling as import).
  let source = await findGitSource(args.userId, parsed.url, parsed.ref ?? null)
  if (!source) {
    try {
      source = await insertSkillSource(pool, {
        userId: args.userId,
        kind: 'git',
        gitType: parsed.type,
        gitUrl: parsed.url,
        gitHost: parsed.host,
        gitOwner: parsed.owner,
        gitRepo: parsed.repo,
        gitRef: parsed.ref,
        credentialName: args.credentialName ?? null,
        lastCommitSha: commitSha,
      })
    } catch (e) {
      const existing = await findGitSource(args.userId, parsed.url, parsed.ref ?? null)
      if (!existing) throw e
      source = existing
    }
  }

  // Subpath occupancy: a different skill already owns this (source_id, subpath).
  // (Our skill is native, so it can't be the occupant — any hit is a conflict.)
  const occupant = await findSkillBySourceSubpath(source.id, subpath)
  if (occupant && occupant.id !== args.skillId) {
    return {
      ok: false,
      status: 409,
      error: `Another skill ("${occupant.name}") already tracks subpath "${subpath}" in this source.`,
    }
  }

  const switched = await switchSkillToGitSource({
    skillId: args.skillId,
    gitSourceId: source.id,
    subpath,
    package: repacked,
    commitSha,
    publishedBy: args.userId,
  })
  if (!switched) {
    // Lost the race: skill deleted or stopped being native between guard and tx.
    return { ok: false, status: 409, error: 'Skill is no longer a native skill' }
  }

  return { ok: true, data: { source, skill: switched.skill, version: switched.version } }
}

// ── source-level sync ──────────────────────────────────────────────────────

interface SyncSourceArgs {
  sourceId: string
  token?: string
  publishedBy: string
}

interface SyncRow {
  skill_id: string
  version_id: string
  content_hash: string
  changed: boolean
}

interface SyncSourceResult {
  source: SkillSource
  results: SyncRow[]
  commit_sha: string | null
}

/**
 * Re-fetch a git source's tarball and walk every dependent skill. For each
 * skill, recompute the repacked-subpath hash; if it differs from the skill's
 * current active version, append a new version and flip active. Same hash
 * means no-op (we still report it with changed=false so callers can show
 * "unchanged" rows in their sync summary).
 *
 * Source-kind guarding (must be 'git') lives in the route handler; this
 * helper assumes the caller already checked.
 */
export async function syncSource(
  args: SyncSourceArgs,
): Promise<{ ok: true; data: SyncSourceResult } | { ok: false; status: number; error: string }> {
  const t0 = Date.now()
  const phases: string[] = []
  const mark = (label: string, start: number) => {
    phases.push(`${label}=${Date.now() - start}ms`)
  }

  const source = await getSourceById(args.sourceId)
  if (!source) return { ok: false, status: 404, error: 'Source not found' }
  if (source.kind !== 'git') {
    return { ok: false, status: 409, error: 'Sync is only valid for git sources' }
  }
  if (!source.git_url) {
    return { ok: false, status: 400, error: 'Source has no git URL' }
  }
  mark('load_source', t0)

  // Pre-check: fetch the upstream HEAD SHA before the (potentially large)
  // tarball download. If it matches `last_commit_sha` no content can have
  // changed — bump last_synced_at and return early. Both GitHub and GitLab
  // implementations of fetchCommitSha exist; for hosts that return null we
  // fall through to the full sync (correctness over speed).
  let parsed: ParsedGitSource
  try {
    parsed = parseGitUrl(source.git_url, source.git_type ?? undefined)
  } catch (e) {
    return { ok: false, status: 400, error: (e as Error).message }
  }
  if (source.git_ref) parsed.ref = source.git_ref

  const tSha = Date.now()
  const commitSha = await gitClient.fetchCommitSha(parsed, args.token).catch(() => null)
  mark('sha_lookup', tSha)

  if (commitSha && source.last_commit_sha && commitSha === source.last_commit_sha) {
    const tBump = Date.now()
    const updatedSource = await withTx((client) =>
      markSourceSynced(client, args.sourceId, commitSha),
    )
    mark('bump_synced_at', tBump)
    console.log(
      `[skills-content] sync (no-op): source=${args.sourceId} sha=${commitSha.slice(0, 7)} total=${Date.now() - t0}ms ${phases.join(' ')}`,
    )
    return {
      ok: true,
      data: { source: updatedSource ?? source, results: [], commit_sha: commitSha },
    }
  }

  const tFetch = Date.now()
  const fetched = await fetchRepo({
    url: source.git_url,
    type: source.git_type ?? undefined,
    ref: source.git_ref ?? undefined,
    token: args.token,
  })
  if (!fetched.ok) return fetched
  const { entries } = fetched.data
  mark('fetch_repo', tFetch)

  const skills = await listSkillsBySource(args.sourceId)

  // Per-skill import is embarrassingly parallel: scoped entry filtering,
  // repack, hash compare, tx insert all run independently. Bound to the
  // number of skills so we don't fan out beyond what the source actually
  // has — typically <10 for monorepos.
  const tImport = Date.now()
  const rows = await Promise.all(
    skills.map(async (skill): Promise<SyncRow | null> => {
      const scoped = filterSubpath(entries, skill.subpath || null)
      if (scoped.length === 0) {
        console.warn(
          `[skills-content] sync: subpath "${skill.subpath}" empty for skill ${skill.id}`,
        )
        return null
      }
      const repacked = await repack(scoped)
      if (repacked.byteLength > maxSkillPackageBytes()) {
        console.warn(`[skills-content] sync: skill ${skill.id} exceeds size limit; skipping`)
        return null
      }
      const currentHash = (await getActiveVersionHash(skill.id))?.content_hash ?? null
      return withTx(async (client) => {
        const { version } = await insertVersion(client, {
          skillId: skill.id,
          sourceId: args.sourceId,
          package: repacked,
          commitSha,
          note: 'sync from git',
          publishedBy: args.publishedBy,
        })
        const changed = currentHash !== version.content_hash
        if (changed) await setActiveVersion(client, skill.id, version.id)
        return {
          skill_id: skill.id,
          version_id: version.id,
          content_hash: version.content_hash,
          changed,
        }
      })
    }),
  )
  const results = rows.filter((r): r is SyncRow => r !== null)
  mark('per_skill_import', tImport)

  const tMark = Date.now()
  const updatedSource = await withTx((client) => markSourceSynced(client, args.sourceId, commitSha))
  mark('mark_synced', tMark)

  console.log(
    `[skills-content] sync: source=${args.sourceId} skills=${skills.length} changed=${results.filter((r) => r.changed).length} sha=${commitSha?.slice(0, 7) ?? 'none'} total=${Date.now() - t0}ms ${phases.join(' ')}`,
  )

  return {
    ok: true,
    data: { source: updatedSource ?? source, results, commit_sha: commitSha },
  }
}
