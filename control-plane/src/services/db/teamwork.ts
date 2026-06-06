import { generateId, pool } from './pool'
import type { Workspace } from './types'

export interface TeamworkTask {
  id: string
  owner_user_id: string
  name: string
  brief: string | null
  coordinator_workspace_id: string
  afs_share_id: string | null
  created_at: Date
  updated_at: Date
}

interface TeamworkParticipant {
  task_id: string
  workspace_id: string
  joined_at: Date
}

export interface TeamworkParticipantWithWorkspace extends TeamworkParticipant {
  workspace_name: string
  workspace_slug: string | null
  workspace_visibility: string
}

export async function createTeamworkTask(
  ownerUserId: string,
  name: string,
  coordinatorWorkspaceId: string,
  brief?: string,
): Promise<TeamworkTask> {
  const id = generateId()
  await pool.query(
    `INSERT INTO teamwork_tasks (id, owner_user_id, name, brief, coordinator_workspace_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, ownerUserId, name, brief ?? null, coordinatorWorkspaceId],
  )
  return (await getTeamworkTask(id))!
}

export async function getTeamworkTask(id: string): Promise<TeamworkTask | null> {
  const { rows } = await pool.query('SELECT * FROM teamwork_tasks WHERE id = $1', [id])
  return (rows[0] as TeamworkTask) ?? null
}

export async function updateTeamworkTask(
  id: string,
  patch: {
    name?: string
    brief?: string | null
    afs_share_id?: string | null
  },
): Promise<TeamworkTask | null> {
  const sets: string[] = []
  const params: unknown[] = []
  let i = 1
  if (patch.name !== undefined) {
    sets.push(`name = $${i++}`)
    params.push(patch.name)
  }
  if (patch.brief !== undefined) {
    sets.push(`brief = $${i++}`)
    params.push(patch.brief)
  }
  if (patch.afs_share_id !== undefined) {
    sets.push(`afs_share_id = $${i++}`)
    params.push(patch.afs_share_id)
  }
  if (sets.length === 0) return getTeamworkTask(id)
  sets.push('updated_at = now()')
  params.push(id)
  await pool.query(`UPDATE teamwork_tasks SET ${sets.join(', ')} WHERE id = $${i}`, params)
  return getTeamworkTask(id)
}

export async function deleteTeamworkTask(id: string): Promise<boolean> {
  const r = await pool.query('DELETE FROM teamwork_tasks WHERE id = $1', [id])
  return (r.rowCount ?? 0) > 0
}

export async function listTeamworkTasksForOwner(userId: string): Promise<TeamworkTask[]> {
  const { rows } = await pool.query(
    `SELECT * FROM teamwork_tasks
      WHERE owner_user_id = $1
      ORDER BY updated_at DESC`,
    [userId],
  )
  return rows as TeamworkTask[]
}

export async function addTeamworkParticipant(taskId: string, workspaceId: string): Promise<void> {
  await pool.query(
    `INSERT INTO teamwork_participants (task_id, workspace_id)
     VALUES ($1, $2)
     ON CONFLICT (task_id, workspace_id) DO NOTHING`,
    [taskId, workspaceId],
  )
}

export async function removeTeamworkParticipant(
  taskId: string,
  workspaceId: string,
): Promise<boolean> {
  const r = await pool.query(
    'DELETE FROM teamwork_participants WHERE task_id = $1 AND workspace_id = $2',
    [taskId, workspaceId],
  )
  return (r.rowCount ?? 0) > 0
}

export async function listTeamworkParticipants(
  taskId: string,
): Promise<TeamworkParticipantWithWorkspace[]> {
  const { rows } = await pool.query(
    `SELECT p.*,
            w.name AS workspace_name,
            w.slug AS workspace_slug,
            w.visibility AS workspace_visibility
       FROM teamwork_participants p
       JOIN workspaces w ON w.id = p.workspace_id
      WHERE p.task_id = $1
      ORDER BY p.joined_at ASC`,
    [taskId],
  )
  return rows as TeamworkParticipantWithWorkspace[]
}

/**
 * Workspaces eligible to join a teamwork roster:
 *   - own workspaces, any visibility (including private — coordinator
 *     dispatches under the same user). Slug not required at this layer; the
 *     UI surfaces missing-slug as a hint since call_agent dispatch needs it.
 *   - other users' public workspaces with a slug (cross-user dispatch
 *     can't function without one).
 * Status is not filtered — UI surfaces it and lets the user decide.
 */
export async function listRosterCandidates(
  callerUserId: string,
): Promise<(Workspace & { owner_name: string })[]> {
  const { rows } = await pool.query(
    `SELECT w.*, u.username AS owner_name FROM workspaces w
       JOIN users u ON w.user_id = u.id
      WHERE w.user_id = $1
         OR (w.user_id != $1 AND w.visibility = 'public' AND w.slug IS NOT NULL)
      ORDER BY w.user_id = $1 DESC, w.name ASC`,
    [callerUserId],
  )
  return rows as (Workspace & { owner_name: string })[]
}

/**
 * Resolve a slug to a roster workspace inside a teamwork task. Used as a
 * fallback by call_agent when the global visibility rules in
 * `resolveWorkspaceBySlug` reject a target (typically because it's
 * `visibility='private'`).
 *
 * Only resolves to workspaces owned by `callerUserId` — the per-task scope
 * intentionally never grants reach into other users' private workspaces
 * (cross-user roster members are always public and resolved via the global
 * path). Slug formats accepted: bare `slug` and `username/slug`; both must
 * resolve to a workspace whose owner matches the caller.
 */
export async function resolveRosterMemberBySlug(
  slugRef: string,
  callerUserId: string,
  taskId: string,
): Promise<Workspace | null> {
  const slashIdx = slugRef.indexOf('/')
  if (slashIdx >= 0) {
    const username = slugRef.slice(0, slashIdx)
    const slug = slugRef.slice(slashIdx + 1)
    const { rows } = await pool.query(
      `SELECT w.* FROM workspaces w
         JOIN users u ON u.id = w.user_id
         JOIN teamwork_participants tp ON tp.workspace_id = w.id
        WHERE tp.task_id = $1
          AND w.user_id = $2
          AND u.username = $3
          AND w.slug = $4
        LIMIT 1`,
      [taskId, callerUserId, username, slug],
    )
    return (rows[0] as Workspace) ?? null
  }
  const { rows } = await pool.query(
    `SELECT w.* FROM workspaces w
       JOIN teamwork_participants tp ON tp.workspace_id = w.id
      WHERE tp.task_id = $1
        AND w.user_id = $2
        AND w.slug = $3
      LIMIT 1`,
    [taskId, callerUserId, slugRef],
  )
  return (rows[0] as Workspace) ?? null
}

// ── Sessions associated with a task ────────────────────────────────────────

type TeamworkSessionRole = 'coordinator' | 'member'

interface TeamworkSession {
  task_id: string
  session_id: string
  role: TeamworkSessionRole
  parent_session_id: string | null
  created_at: Date
}

/**
 * Idempotent: if the (task_id, session_id) pair already exists we leave the
 * existing row untouched. Used by the coordinator-chat session-created hook.
 */
export async function addTeamworkSession(
  taskId: string,
  sessionId: string,
  role: TeamworkSessionRole = 'coordinator',
  parentSessionId: string | null = null,
): Promise<void> {
  await pool.query(
    `INSERT INTO teamwork_sessions (task_id, session_id, role, parent_session_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (task_id, session_id) DO NOTHING`,
    [taskId, sessionId, role, parentSessionId],
  )
}

export async function listTeamworkSessions(taskId: string): Promise<TeamworkSession[]> {
  const { rows } = await pool.query(
    `SELECT * FROM teamwork_sessions
      WHERE task_id = $1
      ORDER BY created_at ASC`,
    [taskId],
  )
  return rows as TeamworkSession[]
}

/**
 * Reverse lookup: given a session_id, find the teamwork task it belongs to.
 *
 * Replaces the legacy `X-Task-Id` MCP header path: the MCP handler now
 * resolves a session_token to a session_id, then calls this to recover the
 * task context. `teamwork_sessions.session_id` already carries the index
 * (see migration 085); the FK to `sessions(id)` guarantees the join target
 * exists.
 *
 * Returns null when the session is not part of any task (the common
 * non-teamwork chat path).
 */
export async function findTaskBySession(sessionId: string): Promise<string | null> {
  const { rows } = await pool.query<{ task_id: string }>(
    'SELECT task_id FROM teamwork_sessions WHERE session_id = $1 LIMIT 1',
    [sessionId],
  )
  return rows[0]?.task_id ?? null
}
