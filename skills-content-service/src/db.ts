/**
 * Postgres connection + write-side helpers for the p3 schema.
 *
 * scs owns all writes to `skills`, `skill_sources`, `skill_versions`. cp reads
 * the same tables through the shared pool but mutates them only via the HTTP
 * surface in `index.ts` (which routes to the helpers below). Every mutation
 * here completes in a single Postgres transaction; there are no distributed
 * commits across services.
 */
import { Pool, type PoolClient } from 'pg'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is required')
  process.exit(1)
}

export const pool = new Pool({ connectionString: url, max: 8 })

// ── shared row shapes (must match cp's db/types.ts) ────────────────────────

type SkillVisibility = 'private' | 'team' | 'public'
type SkillSourceKind = 'git' | 'native'

export interface SkillMeta {
  id: string
  source_id: string
  source_kind: SkillSourceKind
  active_version_id: string | null
  name: string
  subpath: string
  description: string
  user_id: string
  is_public: boolean
  visibility: SkillVisibility
  owner_name: string
  category: string | null
  created_at: string
  updated_at: string
}

export interface SkillSource {
  id: string
  user_id: string
  kind: SkillSourceKind
  git_type: string | null
  git_url: string | null
  git_host: string | null
  git_owner: string | null
  git_repo: string | null
  git_ref: string | null
  credential_name: string | null
  last_commit_sha: string | null
  last_synced_at: string | null
  has_draft: boolean
  // unfiltered skill count under this source. Cp consumers use it to tell
  // truly orphaned sources apart from sources whose skills are just filtered
  // out client-side.
  skill_count: number
  created_at: string
  updated_at: string
}

export interface SkillVersion {
  id: string
  skill_id: string
  source_id: string
  content_hash: string
  commit_sha: string | null
  note: string | null
  published_at: string
  published_by: string
}

// SELECT projections. `owner_name` is denormalised from users; the existing
// schema joins via `user_id → users.id`. We don't ship the package bytes here.
const SKILL_COLS = `
  s.id, s.source_id, ss.kind AS source_kind, s.active_version_id,
  s.name, s.subpath, s.description,
  s.user_id, s.is_public, s.visibility,
  COALESCE(u.display_name, s.user_id) AS owner_name,
  s.category,
  to_char(s.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
  to_char(s.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at
`

const SOURCE_COLS = `
  skill_sources.id, skill_sources.user_id, skill_sources.kind,
  skill_sources.git_type, skill_sources.git_url, skill_sources.git_host,
  skill_sources.git_owner, skill_sources.git_repo, skill_sources.git_ref,
  skill_sources.credential_name, skill_sources.last_commit_sha,
  to_char(skill_sources.last_synced_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS last_synced_at,
  (skill_sources.draft_package IS NOT NULL) AS has_draft,
  (SELECT COUNT(*)::int FROM skills WHERE skills.source_id = skill_sources.id) AS skill_count,
  to_char(skill_sources.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
  to_char(skill_sources.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at
`

const VERSION_COLS = `
  id, skill_id, source_id, content_hash, commit_sha, note,
  to_char(published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS published_at,
  published_by
`

// ── read helpers ──────────────────────────────────────────────────────────

export async function getSourceById(id: string): Promise<SkillSource | null> {
  const { rows } = await pool.query<SkillSource>(
    `SELECT ${SOURCE_COLS} FROM skill_sources WHERE id = $1`,
    [id],
  )
  return rows[0] ?? null
}

export async function getSkillById(id: string): Promise<SkillMeta | null> {
  const { rows } = await pool.query<SkillMeta>(
    `SELECT ${SKILL_COLS}
       FROM skills s
       LEFT JOIN users u ON u.id = s.user_id
       JOIN skill_sources ss ON ss.id = s.source_id
      WHERE s.id = $1`,
    [id],
  )
  return rows[0] ?? null
}

/** Active version package bytes for a skill. Returns null when no active
 * version exists (transient state right after create) or skill missing. */
export async function getActiveVersionPackage(
  skillId: string,
): Promise<{ content_hash: string; package: Buffer; name: string } | null> {
  const { rows } = await pool.query<{ content_hash: string; package: Buffer; name: string }>(
    `SELECT v.content_hash, v.package, s.name
       FROM skills s
       JOIN skill_versions v ON v.id = s.active_version_id
      WHERE s.id = $1`,
    [skillId],
  )
  return rows[0] ?? null
}

/** Active-version content hash only, no bytes. Used to probe the cache key. */
export async function getActiveVersionHash(
  skillId: string,
): Promise<{ content_hash: string } | null> {
  const { rows } = await pool.query<{ content_hash: string }>(
    `SELECT v.content_hash
       FROM skills s
       JOIN skill_versions v ON v.id = s.active_version_id
      WHERE s.id = $1`,
    [skillId],
  )
  return rows[0] ?? null
}

export async function getVersionPackage(
  versionId: string,
): Promise<{ content_hash: string; package: Buffer; skill_id: string; name: string } | null> {
  const { rows } = await pool.query<{
    content_hash: string
    package: Buffer
    skill_id: string
    name: string
  }>(
    `SELECT v.content_hash, v.package, v.skill_id, s.name
       FROM skill_versions v
       JOIN skills s ON s.id = v.skill_id
      WHERE v.id = $1`,
    [versionId],
  )
  return rows[0] ?? null
}

export async function getDraftPackage(sourceId: string): Promise<Buffer | null> {
  const { rows } = await pool.query<{ draft_package: Buffer | null }>(
    'SELECT draft_package FROM skill_sources WHERE id = $1',
    [sourceId],
  )
  return rows[0]?.draft_package ?? null
}

/** List skills belonging to a source — used by source-level sync. */
export async function listSkillsBySource(sourceId: string): Promise<SkillMeta[]> {
  const { rows } = await pool.query<SkillMeta>(
    `SELECT ${SKILL_COLS}
       FROM skills s
       LEFT JOIN users u ON u.id = s.user_id
       JOIN skill_sources ss ON ss.id = s.source_id
      WHERE s.source_id = $1`,
    [sourceId],
  )
  return rows
}

/** Find a git source by its (user_id, url, ref) natural key. NULL refs match. */
export async function findGitSource(
  userId: string,
  gitUrl: string,
  gitRef: string | null,
): Promise<SkillSource | null> {
  const { rows } = await pool.query<SkillSource>(
    `SELECT ${SOURCE_COLS}
       FROM skill_sources
      WHERE kind = 'git'
        AND user_id = $1
        AND git_url = $2
        AND git_ref IS NOT DISTINCT FROM $3`,
    [userId, gitUrl, gitRef],
  )
  return rows[0] ?? null
}

/** Find a skill by (source_id, subpath). Used by import-from-git to detect
 *  whether we're creating a new subpath or refreshing an existing one. */
export async function findSkillBySourceSubpath(
  sourceId: string,
  subpath: string,
): Promise<SkillMeta | null> {
  const { rows } = await pool.query<SkillMeta>(
    `SELECT ${SKILL_COLS}
       FROM skills s
       LEFT JOIN users u ON u.id = s.user_id
       JOIN skill_sources ss ON ss.id = s.source_id
      WHERE s.source_id = $1 AND s.subpath = $2`,
    [sourceId, subpath],
  )
  return rows[0] ?? null
}

/** Find a skill by (user_id, name). Used by upload + import paths to make
 *  re-publish / re-import idempotent on name — instead of throwing on the
 *  `skills_user_name_uniq` constraint, callers fall back to appending a
 *  new version on the existing skill. */
export async function findSkillByOwnerName(
  userId: string,
  name: string,
): Promise<SkillMeta | null> {
  const { rows } = await pool.query<SkillMeta>(
    `SELECT ${SKILL_COLS}
       FROM skills s
       LEFT JOIN users u ON u.id = s.user_id
       JOIN skill_sources ss ON ss.id = s.source_id
      WHERE s.user_id = $1 AND s.name = $2`,
    [userId, name],
  )
  return rows[0] ?? null
}

// ── write helpers ─────────────────────────────────────────────────────────

export async function withTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const out = await fn(client)
    await client.query('COMMIT')
    return out
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

interface InsertSourceArgs {
  userId: string
  kind: SkillSourceKind
  gitType?: string | null
  gitUrl?: string | null
  gitHost?: string | null
  gitOwner?: string | null
  gitRepo?: string | null
  gitRef?: string | null
  credentialName?: string | null
  lastCommitSha?: string | null
}

export async function insertSkillSource(
  client: PoolClient | Pool,
  args: InsertSourceArgs,
): Promise<SkillSource> {
  const { rows } = await client.query<SkillSource>(
    `INSERT INTO skill_sources (
       user_id, kind, git_type, git_url, git_host, git_owner, git_repo, git_ref,
       credential_name, last_commit_sha,
       last_synced_at
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, CASE WHEN $2 = 'git' THEN NOW() ELSE NULL END)
     RETURNING ${SOURCE_COLS}`,
    [
      args.userId,
      args.kind,
      args.gitType ?? null,
      args.gitUrl ?? null,
      args.gitHost ?? null,
      args.gitOwner ?? null,
      args.gitRepo ?? null,
      args.gitRef ?? null,
      args.credentialName ?? null,
      args.lastCommitSha ?? null,
    ],
  )
  return rows[0]
}

interface InsertSkillArgs {
  userId: string
  sourceId: string
  name: string
  subpath: string
  description: string
  visibility: SkillVisibility
  category: string | null
}

export async function insertSkill(
  client: PoolClient | Pool,
  args: InsertSkillArgs,
): Promise<SkillMeta> {
  const isPublic = args.visibility === 'public'
  // Two-step insert + reselect: we need the LEFT JOIN to users for owner_name.
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO skills (
       source_id, user_id, name, subpath, description,
       is_public, visibility, category
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id`,
    [
      args.sourceId,
      args.userId,
      args.name,
      args.subpath,
      args.description,
      isPublic,
      args.visibility,
      args.category,
    ],
  )
  const id = rows[0].id
  const got = await reselectSkill(client, id)
  if (!got) throw new Error('insertSkill: row vanished after insert')
  return got
}

async function reselectSkill(client: PoolClient | Pool, id: string): Promise<SkillMeta | null> {
  const { rows } = await client.query<SkillMeta>(
    `SELECT ${SKILL_COLS}
       FROM skills s
       LEFT JOIN users u ON u.id = s.user_id
       JOIN skill_sources ss ON ss.id = s.source_id
      WHERE s.id = $1`,
    [id],
  )
  return rows[0] ?? null
}

interface InsertVersionArgs {
  skillId: string
  sourceId: string
  package: Buffer
  commitSha: string | null
  note: string | null
  publishedBy: string
}

/**
 * Insert a new version. UNIQUE(skill_id, content_hash) makes re-import of
 * identical bytes idempotent — on conflict we return the existing row plus
 * `created=false` so callers can skip the active-version flip.
 */
export async function insertVersion(
  client: PoolClient | Pool,
  args: InsertVersionArgs,
): Promise<{ version: SkillVersion; created: boolean }> {
  const { rows } = await client.query<SkillVersion & { _created: boolean }>(
    `INSERT INTO skill_versions (
       skill_id, source_id, package, commit_sha, note, published_by
     )
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (skill_id, content_hash) DO UPDATE SET
       -- bogus SET so RETURNING fires; we keep the existing row's fields.
       note = skill_versions.note
     RETURNING ${VERSION_COLS}, (xmax = 0) AS _created`,
    [args.skillId, args.sourceId, args.package, args.commitSha, args.note, args.publishedBy],
  )
  const row = rows[0]
  const created = row._created
  const version: SkillVersion = {
    id: row.id,
    skill_id: row.skill_id,
    source_id: row.source_id,
    content_hash: row.content_hash,
    commit_sha: row.commit_sha,
    note: row.note,
    published_at: row.published_at,
    published_by: row.published_by,
  }
  return { version, created }
}

export async function setActiveVersion(
  client: PoolClient | Pool,
  skillId: string,
  versionId: string,
): Promise<SkillMeta | null> {
  const { rowCount } = await client.query(
    `UPDATE skills SET active_version_id = $1, updated_at = NOW()
      WHERE id = $2`,
    [versionId, skillId],
  )
  if (!rowCount) return null
  return reselectSkill(client, skillId)
}

export async function patchSkill(
  skillId: string,
  args: {
    name?: string
    description?: string
    visibility?: SkillVisibility
    category?: string | null
  },
): Promise<SkillMeta | null> {
  // Build dynamic SET clause. category is intentionally distinguished from
  // "absent" so callers can null it explicitly.
  const sets: string[] = []
  const params: unknown[] = []
  let i = 1
  if (args.name !== undefined) {
    sets.push(`name = $${i++}`)
    params.push(args.name)
  }
  if (args.description !== undefined) {
    sets.push(`description = $${i++}`)
    params.push(args.description)
  }
  if (args.visibility !== undefined) {
    sets.push(`visibility = $${i++}`)
    params.push(args.visibility)
    sets.push(`is_public = $${i++}`)
    params.push(args.visibility === 'public')
  }
  if (args.category !== undefined) {
    sets.push(`category = $${i++}`)
    params.push(args.category)
  }
  if (sets.length === 0) return getSkillById(skillId)
  sets.push('updated_at = NOW()')
  params.push(skillId)
  const { rowCount } = await pool.query(
    `UPDATE skills SET ${sets.join(', ')} WHERE id = $${i}`,
    params,
  )
  if (!rowCount) return null
  return getSkillById(skillId)
}

export async function patchSource(
  sourceId: string,
  args: { credentialName?: string | null; gitRef?: string },
): Promise<SkillSource | null> {
  const sets: string[] = []
  const params: unknown[] = []
  let i = 1
  if (args.credentialName !== undefined) {
    sets.push(`credential_name = $${i++}`)
    params.push(args.credentialName)
  }
  if (args.gitRef !== undefined) {
    sets.push(`git_ref = $${i++}`)
    params.push(args.gitRef)
  }
  if (sets.length === 0) return getSourceById(sourceId)
  sets.push('updated_at = NOW()')
  params.push(sourceId)
  const { rowCount } = await pool.query(
    `UPDATE skill_sources SET ${sets.join(', ')} WHERE id = $${i}`,
    params,
  )
  if (!rowCount) return null
  return getSourceById(sourceId)
}

/** Delete a source. Returns dependent skill ids when FK RESTRICT blocks. */
export async function deleteSource(
  sourceId: string,
): Promise<{ ok: true } | { ok: false; dependentSkills: string[] }> {
  // Pre-check dependents so we can return a meaningful 409 payload instead
  // of a Postgres error string.
  const { rows: deps } = await pool.query<{ id: string }>(
    'SELECT id FROM skills WHERE source_id = $1',
    [sourceId],
  )
  if (deps.length > 0) {
    return { ok: false, dependentSkills: deps.map((r) => r.id) }
  }
  await pool.query('DELETE FROM skill_sources WHERE id = $1', [sourceId])
  return { ok: true }
}

export async function deleteSkill(skillId: string): Promise<boolean> {
  // CASCADE on skill_versions and skill_grants is set at FK level. cp is
  // responsible for blocking on workspace_skills / template_version_skills
  // ahead of calling us (those FKs are RESTRICT).
  //
  // Native sources are 1:1 with their skill — once the skill is gone, the
  // source row carries no business meaning (its only field of identity,
  // the skill's name, is on the deleted row) and there's no UI surface to
  // clean it up. We collapse the two deletes into one tx so the orphan
  // can't outlive the skill. Git sources stay: they're explicitly
  // multi-skill, and an empty git source is a legitimate transient state
  // (monorepo waiting for the next sync to repopulate).
  return withTx(async (client) => {
    const { rows } = await client.query<{ source_id: string; source_kind: string }>(
      `SELECT s.source_id, ss.kind AS source_kind
         FROM skills s JOIN skill_sources ss ON ss.id = s.source_id
        WHERE s.id = $1`,
      [skillId],
    )
    if (rows.length === 0) return false
    const { source_id, source_kind } = rows[0]
    const del = await client.query('DELETE FROM skills WHERE id = $1', [skillId])
    const deleted = (del.rowCount ?? 0) > 0
    if (deleted && source_kind === 'native') {
      await client.query("DELETE FROM skill_sources WHERE id = $1 AND kind = 'native'", [
        source_id,
      ])
    }
    return deleted
  })
}

/**
 * Switch a native skill to a git source in place, wiping its native version
 * history. One transaction:
 *   1. DELETE every existing version (active_version_id auto-nulls via the
 *      ON DELETE SET NULL FK, and clearing them first means the git version
 *      can't collide on UNIQUE(skill_id, content_hash)).
 *   2. INSERT the freshly-fetched git version under the git source.
 *   3. Repoint skills.source_id / subpath / active_version_id at it.
 *   4. DELETE the now-orphaned native source (1:1 with the skill, including
 *      any unpublished draft_package).
 *
 * The skill's UUID never changes, so all mounts (workspace_skills /
 * template_version_skills / skill_grants) carry over with zero re-mounting.
 * Returns null if the skill is missing or is not currently a native skill —
 * the caller guards kind upstream but we re-check inside the tx.
 */
export async function switchSkillToGitSource(args: {
  skillId: string
  gitSourceId: string
  subpath: string
  package: Buffer
  commitSha: string | null
  publishedBy: string
}): Promise<{ skill: SkillMeta; version: SkillVersion } | null> {
  return withTx(async (client) => {
    const { rows } = await client.query<{ source_id: string; source_kind: string }>(
      `SELECT s.source_id, ss.kind AS source_kind
         FROM skills s JOIN skill_sources ss ON ss.id = s.source_id
        WHERE s.id = $1
        FOR UPDATE OF s`,
      [args.skillId],
    )
    if (rows.length === 0) return null
    const { source_id: oldSourceId, source_kind } = rows[0]
    if (source_kind !== 'native') return null

    // 1. Wipe native history (active_version_id → NULL via ON DELETE SET NULL).
    await client.query('DELETE FROM skill_versions WHERE skill_id = $1', [args.skillId])

    // 2. Insert the git version (no conflict possible — history is gone).
    const { version } = await insertVersion(client, {
      skillId: args.skillId,
      sourceId: args.gitSourceId,
      package: args.package,
      commitSha: args.commitSha,
      note: 'switch source: native → git',
      publishedBy: args.publishedBy,
    })

    // 3. Repoint the skill at the git source.
    await client.query(
      `UPDATE skills
          SET source_id = $1, subpath = $2, active_version_id = $3, updated_at = NOW()
        WHERE id = $4`,
      [args.gitSourceId, args.subpath, version.id, args.skillId],
    )

    // 4. Drop the orphaned native source (carries the wiped draft with it).
    await client.query("DELETE FROM skill_sources WHERE id = $1 AND kind = 'native'", [oldSourceId])

    const skill = await reselectSkill(client, args.skillId)
    if (!skill) throw new Error('switchSkillToGitSource: skill vanished after repoint')
    return { skill, version }
  })
}

/** Save / overwrite a native source's draft package. */
export async function saveDraftPackage(
  sourceId: string,
  bytes: Buffer,
): Promise<{ byteCount: number } | null> {
  const { rowCount } = await pool.query(
    `UPDATE skill_sources SET draft_package = $1, updated_at = NOW()
      WHERE id = $2 AND kind = 'native'`,
    [bytes, sourceId],
  )
  if (!rowCount) return null
  return { byteCount: bytes.byteLength }
}

export async function clearDraftPackage(sourceId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE skill_sources SET draft_package = NULL, updated_at = NOW()
      WHERE id = $1 AND kind = 'native'`,
    [sourceId],
  )
  return (rowCount ?? 0) > 0
}

/** Update sync bookkeeping on a git source. */
export async function markSourceSynced(
  client: PoolClient | Pool,
  sourceId: string,
  commitSha: string | null,
): Promise<SkillSource | null> {
  const { rowCount } = await client.query(
    `UPDATE skill_sources SET
       last_commit_sha = COALESCE($1, last_commit_sha),
       last_synced_at = NOW(),
       updated_at = NOW()
     WHERE id = $2`,
    [commitSha, sourceId],
  )
  if (!rowCount) return null
  const { rows } = await client.query<SkillSource>(
    `SELECT ${SOURCE_COLS} FROM skill_sources WHERE id = $1`,
    [sourceId],
  )
  return rows[0] ?? null
}
