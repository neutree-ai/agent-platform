/**
 * SkillRepository port + Postgres adapter for cp's slice of the skills
 * bounded context.
 *
 * Ownership split (p3): scs owns all writes to `skills`, `skill_sources`,
 * `skill_versions`; cp owns writes to the relation tables `workspace_skills`,
 * `skill_grants`, `template_version_skills`. cp READS the scs-owned tables
 * freely (shared Postgres) to support ACL joins and grant validation, but
 * never WRITES them. Production write methods on those tables have been
 * removed from this port; tests still seed via the in-memory fake's
 * `_seed*` helpers.
 *
 * This split avoids cross-service distributed transactions: every mutation
 * touches exactly one service's tables, scoped to one PG transaction inside
 * that service.
 *
 * SkillsService orchestrates: it calls scs over HTTP for content writes,
 * then issues cp-local writes (grants, workspace attaches) and side-effects
 * (agent reload notifications).
 */
import { pool } from './db/pool'
import type {
  SkillMeta,
  SkillSource,
  SkillSourceKind,
  SkillVersion,
  SkillVisibility,
  Workspace,
} from './db/types'

// ── types ──────────────────────────────────────────────────────────────────

type SkillMyPermission = 'owner' | 'editor' | 'viewer' | 'public'

interface SkillSharedTeam {
  id: string
  name: string
  permission: 'viewer' | 'editor'
}

export interface SkillWithAccess extends SkillMeta {
  is_owner: boolean
  my_permission: SkillMyPermission
  shared_via_teams: SkillSharedTeam[]
}

export interface SkillGrantInput {
  team_id: string
  permission: 'viewer' | 'editor'
}

export interface SkillGrantRow {
  team_id: string
  team_name: string
  permission: 'viewer' | 'editor'
  granted_at: string
}

/**
 * Optional filters for `listVisibleToUser`. AND-composed, applied *after*
 * the visibility join so the result stays a subset of what the user can see.
 */
export interface ListSkillsFilters {
  query?: string
  ownerId?: string
  /**
   * OR-composed. The sentinel `"uncategorized"` includes skills with
   * `category IS NULL`; non-sentinel entries match `category` exactly.
   * Empty (or all falsy) is a no-op.
   */
  categories?: string[]
  visibility?: SkillVisibility
}

/**
 * Result of the pre-delete check: cp asks the repo whether anything in its
 * own relation tables still references a skill before asking scs to delete
 * it. Empty arrays => safe to delete.
 */
export interface SkillDeleteBlockers {
  workspace_ids: string[]
  template_version_ids: string[]
}

/**
 * Occupancy detail surfaced to the owner before a delete / visibility
 * narrowing. The owner's own workspaces are named; other users' workspaces
 * collapse to a count so we never expose who-uses-what across the user
 * boundary (NAP users cannot see each other).
 */
export interface SkillDependents {
  own_workspaces: { id: string; name: string }[]
  other_workspace_count: number
  template_version_count: number
}

// ── interface ──────────────────────────────────────────────────────────────

export interface SkillRepository {
  // skills / sources / versions: READ-ONLY (writes live in scs).
  listVisibleToUser(userId: string, filters?: ListSkillsFilters): Promise<SkillWithAccess[]>
  getSkillForUser(id: string, userId: string): Promise<SkillWithAccess | null>
  getSkillByNameForUser(name: string, ownerId: string): Promise<SkillMeta | null>
  /**
   * Find a skill by name that `userId` can write to (owner OR editor via a
   * team grant). Owned hits win over editor grants so a user who shadows a
   * shared name keeps editing their own copy. Returns null if nothing
   * matches or the user only has viewer access.
   */
  getWritableSkillByName(name: string, userId: string): Promise<SkillMeta | null>
  getSkillMeta(id: string): Promise<SkillMeta | null>
  listSkills(): Promise<SkillMeta[]>

  getSource(id: string): Promise<SkillSource | null>
  findGitSource(userId: string, gitUrl: string, gitRef: string): Promise<SkillSource | null>
  listSourcesForUser(userId: string, kind?: SkillSourceKind): Promise<SkillSource[]>
  listSkillsForSource(sourceId: string): Promise<SkillMeta[]>

  listVersions(skillId: string): Promise<SkillVersion[]>
  getVersion(versionId: string): Promise<SkillVersion | null>

  /** Pre-flight for DELETE: any workspace / template_version still using this skill? */
  getDeleteBlockers(skillId: string): Promise<SkillDeleteBlockers>

  /** Occupancy preview for the owner: own workspaces by name, others by count. */
  getSkillDependents(skillId: string, ownerId: string): Promise<SkillDependents>

  // skill_grants: cp owns the writes.
  listSkillGrants(skillId: string): Promise<SkillGrantRow[]>
  setSkillGrants(skillId: string, grants: SkillGrantInput[], grantedBy: string): Promise<void>

  // workspace_skills: cp owns the writes.
  getWorkspaceSkillIds(workspaceId: string): Promise<string[]>
  /**
   * One-query projection of a workspace's enabled skills carrying just what the
   * agent load endpoint needs (identity, name, owner, source kind). Replaces the
   * former getWorkspaceSkillIds + N×(getSkillMeta + getSource) fan-out.
   */
  getWorkspaceSkillsForAgent(workspaceId: string): Promise<WorkspaceSkillRow[]>
  setWorkspaceSkills(workspaceId: string, skillIds: string[]): Promise<void>
  findSkillIdsNotVisibleToUser(skillIds: string[], userId: string): Promise<string[]>
  listWorkspacesUsingSkill(skillId: string): Promise<Workspace[]>
  countNonOwnerWorkspacesUsingSkill(skillId: string, ownerId: string): Promise<number>
}

/** Minimal per-skill row for the agent workspace-skills load endpoint. */
export interface WorkspaceSkillRow {
  id: string
  name: string
  user_id: string | null
  source_kind: string | null
}

// ── adapter ────────────────────────────────────────────────────────────────

// Column list for the SkillMeta projection. Always JOINs `users` for owner_name
// and `skill_sources` for source_kind (the UI uses it to gate Library editing).
const META_COLS = `s.id, s.source_id, ss.kind AS source_kind, s.active_version_id,
  s.name, s.subpath, s.description, s.user_id, s.is_public, s.visibility, s.category,
  u.display_name AS owner_name, s.created_at, s.updated_at`

const SOURCE_COLS = `id, user_id, kind, git_type, git_url, git_host, git_owner,
  git_repo, git_ref, credential_name, last_commit_sha, last_synced_at,
  (draft_package IS NOT NULL) AS has_draft,
  (SELECT COUNT(*)::int FROM skills s WHERE s.source_id = skill_sources.id) AS skill_count,
  created_at, updated_at`

const VERSION_COLS = `id, skill_id, source_id, content_hash, commit_sha, note,
  published_at, published_by`

/**
 * Sentinel category value clients send to filter for "no category set".
 * Kept out of the regular string space so a user who literally names their
 * category "uncategorized" is unambiguous (they'd pass the column's NULL).
 */
export const UNCATEGORIZED_SENTINEL = 'uncategorized'

export class PgSkillRepository implements SkillRepository {
  // ─── skills (read) ───────────────────────────────────────────────────────

  async listVisibleToUser(
    userId: string,
    filters: ListSkillsFilters = {},
  ): Promise<SkillWithAccess[]> {
    const queryParam = filters.query?.trim() ? filters.query.trim() : null
    const ownerParam = filters.ownerId?.trim() ? filters.ownerId.trim() : null
    const visibilityParam = filters.visibility ?? null
    const cats = (filters.categories ?? []).map((c) => c.trim()).filter(Boolean)
    const wantUncategorized = cats.includes(UNCATEGORIZED_SENTINEL)
    const categoryValues = cats.filter((c) => c !== UNCATEGORIZED_SENTINEL)
    const { rows } = await pool.query(
      `WITH my_grants AS (
         SELECT sg.skill_id, sg.team_id, sg.permission, t.name AS team_name
           FROM skill_grants sg
           JOIN team_members tm ON tm.team_id = sg.team_id AND tm.user_id = $1
           JOIN teams t ON t.id = sg.team_id
       ),
       visible AS (
         SELECT s.id FROM skills s WHERE s.user_id = $1
         UNION
         SELECT s.id FROM skills s WHERE s.visibility = 'public'
         UNION
         SELECT skill_id FROM my_grants
       )
       SELECT ${META_COLS},
              (s.user_id = $1) AS is_owner,
              COALESCE(
                (SELECT json_agg(json_build_object(
                   'id', mg.team_id,
                   'name', mg.team_name,
                   'permission', mg.permission
                 ))
                   FROM my_grants mg WHERE mg.skill_id = s.id),
                '[]'::json
              ) AS shared_via_teams,
              COALESCE(
                (SELECT MAX(CASE permission WHEN 'editor' THEN 2 WHEN 'viewer' THEN 1 END)
                   FROM my_grants mg WHERE mg.skill_id = s.id),
                0
              ) AS grant_rank
         FROM skills s
         JOIN users u ON u.id = s.user_id
         JOIN skill_sources ss ON ss.id = s.source_id
        WHERE s.id IN (SELECT id FROM visible)
          AND ($2::text IS NULL OR s.name ILIKE '%' || $2 || '%' OR s.description ILIKE '%' || $2 || '%')
          AND ($3::text IS NULL OR s.user_id = $3)
          AND (
            cardinality($4::text[]) = 0
            AND $5::boolean = false
            OR s.category = ANY($4::text[])
            OR ($5::boolean AND s.category IS NULL)
          )
          AND ($6::text IS NULL OR s.visibility = $6)
        ORDER BY s.name`,
      [userId, queryParam, ownerParam, categoryValues, wantUncategorized, visibilityParam],
    )
    return rows.map((r) => decorateSkill(r, userId))
  }

  async getSkillForUser(id: string, userId: string): Promise<SkillWithAccess | null> {
    const { rows } = await pool.query(
      `WITH my_grants AS (
         SELECT sg.skill_id, sg.team_id, sg.permission, t.name AS team_name
           FROM skill_grants sg
           JOIN team_members tm ON tm.team_id = sg.team_id AND tm.user_id = $2
           JOIN teams t ON t.id = sg.team_id
          WHERE sg.skill_id = $1
       )
       SELECT ${META_COLS},
              (s.user_id = $2) AS is_owner,
              COALESCE(
                (SELECT json_agg(json_build_object(
                   'id', mg.team_id,
                   'name', mg.team_name,
                   'permission', mg.permission
                 )) FROM my_grants mg),
                '[]'::json
              ) AS shared_via_teams,
              COALESCE(
                (SELECT MAX(CASE permission WHEN 'editor' THEN 2 WHEN 'viewer' THEN 1 END)
                   FROM my_grants),
                0
              ) AS grant_rank
         FROM skills s
         JOIN users u ON u.id = s.user_id
         JOIN skill_sources ss ON ss.id = s.source_id
        WHERE s.id = $1`,
      [id, userId],
    )
    if (rows.length === 0) return null
    const row = rows[0]
    const isOwner = row.user_id === userId
    const isPublic = row.visibility === 'public'
    const grantRank = Number(row.grant_rank) || 0
    if (!isOwner && !isPublic && grantRank === 0) return null
    return decorateSkill(row, userId)
  }

  /**
   * Look up a skill by (owner, name). Used at boundaries where the caller has
   * a user-facing name but needs the canonical id — e.g. translating a
   * picker's selected names into skill_ids before persisting. Returns null
   * when not found; does not check visibility.
   */
  async getSkillByNameForUser(name: string, ownerId: string): Promise<SkillMeta | null> {
    const { rows } = await pool.query(
      `SELECT ${META_COLS}
       FROM skills s JOIN users u ON u.id = s.user_id
         JOIN skill_sources ss ON ss.id = s.source_id
       WHERE s.user_id = $1 AND s.name = $2`,
      [ownerId, name],
    )
    return (rows[0] as SkillMeta) ?? null
  }

  async getWritableSkillByName(name: string, userId: string): Promise<SkillMeta | null> {
    // Owned hits win — if the user already owns a skill with this name,
    // never silently target a shared one (name collisions across owners
    // are possible).
    const owned = await this.getSkillByNameForUser(name, userId)
    if (owned) return owned
    // Editor grant via any of the user's teams. Viewer-only grants are
    // explicitly excluded so a published write doesn't escalate access.
    const { rows } = await pool.query(
      `SELECT ${META_COLS}
       FROM skills s
         JOIN users u ON u.id = s.user_id
         JOIN skill_sources ss ON ss.id = s.source_id
         JOIN skill_grants sg ON sg.skill_id = s.id
         JOIN team_members tm ON tm.team_id = sg.team_id AND tm.user_id = $1
       WHERE s.name = $2 AND sg.permission = 'editor'
       LIMIT 1`,
      [userId, name],
    )
    return (rows[0] as SkillMeta) ?? null
  }

  async getSkillMeta(id: string): Promise<SkillMeta | null> {
    const { rows } = await pool.query(
      `SELECT ${META_COLS}
       FROM skills s JOIN users u ON u.id = s.user_id
         JOIN skill_sources ss ON ss.id = s.source_id
       WHERE s.id = $1`,
      [id],
    )
    return (rows[0] as SkillMeta) ?? null
  }

  async listSkills(): Promise<SkillMeta[]> {
    const { rows } = await pool.query(
      `SELECT ${META_COLS}
       FROM skills s JOIN users u ON s.user_id = u.id
         JOIN skill_sources ss ON ss.id = s.source_id
       ORDER BY s.name`,
    )
    return rows as SkillMeta[]
  }

  // ─── sources / versions (read) ───────────────────────────────────────────

  async getSource(id: string): Promise<SkillSource | null> {
    const { rows } = await pool.query(`SELECT ${SOURCE_COLS} FROM skill_sources WHERE id = $1`, [
      id,
    ])
    return (rows[0] as SkillSource) ?? null
  }

  async findGitSource(userId: string, gitUrl: string, gitRef: string): Promise<SkillSource | null> {
    const { rows } = await pool.query(
      `SELECT ${SOURCE_COLS} FROM skill_sources
       WHERE kind = 'git' AND user_id = $1 AND git_url = $2 AND git_ref = $3`,
      [userId, gitUrl, gitRef],
    )
    return (rows[0] as SkillSource) ?? null
  }

  async listSourcesForUser(userId: string, kind?: SkillSourceKind): Promise<SkillSource[]> {
    const { rows } = await pool.query(
      `SELECT ${SOURCE_COLS} FROM skill_sources
       WHERE user_id = $1 AND ($2::text IS NULL OR kind = $2)
       ORDER BY created_at DESC`,
      [userId, kind ?? null],
    )
    return rows as SkillSource[]
  }

  async listSkillsForSource(sourceId: string): Promise<SkillMeta[]> {
    const { rows } = await pool.query(
      `SELECT ${META_COLS} FROM skills s
       JOIN users u ON u.id = s.user_id
       JOIN skill_sources ss ON ss.id = s.source_id
       WHERE s.source_id = $1
       ORDER BY s.subpath, s.name`,
      [sourceId],
    )
    return rows as SkillMeta[]
  }

  async listVersions(skillId: string): Promise<SkillVersion[]> {
    const { rows } = await pool.query(
      `SELECT ${VERSION_COLS} FROM skill_versions
       WHERE skill_id = $1
       ORDER BY published_at DESC`,
      [skillId],
    )
    return rows as SkillVersion[]
  }

  async getVersion(versionId: string): Promise<SkillVersion | null> {
    const { rows } = await pool.query(`SELECT ${VERSION_COLS} FROM skill_versions WHERE id = $1`, [
      versionId,
    ])
    return (rows[0] as SkillVersion) ?? null
  }

  // ─── delete blockers ─────────────────────────────────────────────────────

  async getDeleteBlockers(skillId: string): Promise<SkillDeleteBlockers> {
    const { rows: wsRows } = await pool.query(
      'SELECT workspace_id FROM workspace_skills WHERE skill_id = $1',
      [skillId],
    )
    const { rows: tvRows } = await pool.query(
      'SELECT template_version_id FROM template_version_skills WHERE skill_id = $1',
      [skillId],
    )
    return {
      workspace_ids: wsRows.map((r) => r.workspace_id),
      template_version_ids: tvRows.map((r) => r.template_version_id),
    }
  }

  async getSkillDependents(skillId: string, ownerId: string): Promise<SkillDependents> {
    const { rows: ownRows } = await pool.query(
      `SELECT w.id, w.name FROM workspace_skills ws
         JOIN workspaces w ON w.id = ws.workspace_id
        WHERE ws.skill_id = $1 AND w.user_id = $2
        ORDER BY w.name`,
      [skillId, ownerId],
    )
    const { rows: otherRows } = await pool.query(
      `SELECT COUNT(*) AS count FROM workspace_skills ws
         JOIN workspaces w ON w.id = ws.workspace_id
        WHERE ws.skill_id = $1 AND w.user_id != $2`,
      [skillId, ownerId],
    )
    const { rows: tvRows } = await pool.query(
      'SELECT COUNT(*) AS count FROM template_version_skills WHERE skill_id = $1',
      [skillId],
    )
    return {
      own_workspaces: ownRows.map((r) => ({ id: r.id as string, name: r.name as string })),
      other_workspace_count: Number.parseInt(otherRows[0].count, 10),
      template_version_count: Number.parseInt(tvRows[0].count, 10),
    }
  }

  // ─── grants (cp owns writes) ─────────────────────────────────────────────

  async listSkillGrants(skillId: string): Promise<SkillGrantRow[]> {
    const { rows } = await pool.query(
      `SELECT sg.team_id, t.name AS team_name, sg.permission, sg.granted_at
         FROM skill_grants sg
         JOIN teams t ON t.id = sg.team_id
        WHERE sg.skill_id = $1
        ORDER BY sg.granted_at ASC`,
      [skillId],
    )
    return rows as SkillGrantRow[]
  }

  async setSkillGrants(
    skillId: string,
    grants: SkillGrantInput[],
    grantedBy: string,
  ): Promise<void> {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      if (grants.length === 0) {
        await client.query('DELETE FROM skill_grants WHERE skill_id = $1', [skillId])
      } else {
        const teamIds = grants.map((g) => g.team_id)
        await client.query(
          'DELETE FROM skill_grants WHERE skill_id = $1 AND team_id <> ALL($2::text[])',
          [skillId, teamIds],
        )
        for (const g of grants) {
          await client.query(
            `INSERT INTO skill_grants (skill_id, team_id, permission, granted_by)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (skill_id, team_id)
             DO UPDATE SET permission = EXCLUDED.permission, granted_by = EXCLUDED.granted_by`,
            [skillId, g.team_id, g.permission, grantedBy],
          )
        }
      }
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  }

  // ─── workspace ↔ skill (cp owns writes) ──────────────────────────────────

  async getWorkspaceSkillIds(workspaceId: string): Promise<string[]> {
    const { rows } = await pool.query(
      `SELECT ws.skill_id FROM workspace_skills ws
       JOIN skills s ON s.id = ws.skill_id
       WHERE ws.workspace_id = $1
       ORDER BY s.name`,
      [workspaceId],
    )
    return rows.map((r: { skill_id: string }) => r.skill_id)
  }

  async getWorkspaceSkillsForAgent(workspaceId: string): Promise<WorkspaceSkillRow[]> {
    const { rows } = await pool.query(
      `SELECT s.id, s.name, s.user_id, ss.kind AS source_kind
         FROM workspace_skills ws
         JOIN skills s ON s.id = ws.skill_id
         LEFT JOIN skill_sources ss ON ss.id = s.source_id
        WHERE ws.workspace_id = $1
        ORDER BY s.name`,
      [workspaceId],
    )
    return rows as WorkspaceSkillRow[]
  }

  /**
   * Replace a workspace's enabled skills. Caller must validate visibility
   * upstream (see SkillsService.attachToWorkspace which uses
   * findSkillIdsNotVisibleToUser as the gate).
   */
  async setWorkspaceSkills(workspaceId: string, skillIds: string[]): Promise<void> {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('DELETE FROM workspace_skills WHERE workspace_id = $1', [workspaceId])
      for (const id of skillIds) {
        await client.query(
          'INSERT INTO workspace_skills (workspace_id, skill_id) VALUES ($1, $2)',
          [workspaceId, id],
        )
      }
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  }

  async findSkillIdsNotVisibleToUser(skillIds: string[], userId: string): Promise<string[]> {
    if (skillIds.length === 0) return []
    const { rows } = await pool.query(
      `WITH input AS (SELECT unnest($1::uuid[]) AS id),
       visible AS (
         SELECT s.id FROM skills s WHERE s.user_id = $2
         UNION
         SELECT s.id FROM skills s WHERE s.visibility = 'public'
         UNION
         SELECT sg.skill_id FROM skill_grants sg
           JOIN team_members tm ON tm.team_id = sg.team_id AND tm.user_id = $2
       )
       SELECT i.id::text AS id FROM input i WHERE i.id NOT IN (SELECT id FROM visible)`,
      [skillIds, userId],
    )
    return rows.map((r: { id: string }) => r.id)
  }

  async listWorkspacesUsingSkill(skillId: string): Promise<Workspace[]> {
    const { rows } = await pool.query(
      `SELECT w.* FROM workspaces w
       JOIN workspace_skills ws ON w.id = ws.workspace_id
       WHERE ws.skill_id = $1 AND w.status = 'running'`,
      [skillId],
    )
    return rows as Workspace[]
  }

  async countNonOwnerWorkspacesUsingSkill(skillId: string, ownerId: string): Promise<number> {
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS count FROM workspace_skills ws
       JOIN workspaces w ON ws.workspace_id = w.id
       WHERE ws.skill_id = $1 AND w.user_id != $2`,
      [skillId, ownerId],
    )
    return Number.parseInt(rows[0].count, 10)
  }
}

// ── helpers ────────────────────────────────────────────────────────────────

interface RawSkillRow extends SkillMeta {
  is_owner: boolean
  shared_via_teams: SkillSharedTeam[] | string
  grant_rank: number | string
}

function decorateSkill(row: RawSkillRow, userId: string): SkillWithAccess {
  const sharedRaw = row.shared_via_teams
  const shared_via_teams: SkillSharedTeam[] =
    typeof sharedRaw === 'string' ? JSON.parse(sharedRaw) : sharedRaw
  const grantRank = Number(row.grant_rank) || 0
  const isOwner = row.user_id === userId
  let my_permission: SkillMyPermission
  if (isOwner) my_permission = 'owner'
  else if (grantRank === 2) my_permission = 'editor'
  else if (grantRank === 1) my_permission = 'viewer'
  else my_permission = 'public'
  return {
    id: row.id,
    source_id: row.source_id,
    source_kind: row.source_kind,
    active_version_id: row.active_version_id,
    name: row.name,
    subpath: row.subpath,
    description: row.description,
    user_id: row.user_id,
    is_public: row.is_public,
    visibility: row.visibility,
    owner_name: row.owner_name,
    category: row.category,
    created_at: row.created_at,
    updated_at: row.updated_at,
    is_owner: isOwner,
    my_permission,
    shared_via_teams,
  }
}
