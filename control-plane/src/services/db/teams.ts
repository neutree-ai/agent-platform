import { generateId, pool } from './pool'

export interface Team {
  id: string
  name: string
  description: string | null
  created_by: string
  created_at: Date
  updated_at: Date
}

export type TeamRole = 'admin' | 'member'

interface TeamMember {
  team_id: string
  user_id: string
  role: TeamRole
  joined_at: Date
}

export interface TeamSummary extends Team {
  my_role: TeamRole
  member_count: number
}

export interface TeamMemberWithUser extends TeamMember {
  user_name: string
}

export async function createTeam(
  createdBy: string,
  name: string,
  description?: string,
): Promise<Team> {
  const id = generateId()
  await pool.query('BEGIN')
  try {
    await pool.query(
      `INSERT INTO teams (id, name, description, created_by)
       VALUES ($1, $2, $3, $4)`,
      [id, name, description ?? null, createdBy],
    )
    await pool.query(`INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'admin')`, [
      id,
      createdBy,
    ])
    await pool.query('COMMIT')
  } catch (err) {
    await pool.query('ROLLBACK')
    throw err
  }
  return (await getTeam(id))!
}

export async function getTeam(id: string): Promise<Team | null> {
  const { rows } = await pool.query('SELECT * FROM teams WHERE id = $1', [id])
  return (rows[0] as Team) ?? null
}

export async function updateTeam(
  id: string,
  patch: { name?: string; description?: string | null },
): Promise<Team | null> {
  const sets: string[] = []
  const params: unknown[] = []
  let i = 1
  if (patch.name !== undefined) {
    sets.push(`name = $${i++}`)
    params.push(patch.name)
  }
  if (patch.description !== undefined) {
    sets.push(`description = $${i++}`)
    params.push(patch.description)
  }
  if (sets.length === 0) return getTeam(id)
  sets.push('updated_at = now()')
  params.push(id)
  await pool.query(`UPDATE teams SET ${sets.join(', ')} WHERE id = $${i}`, params)
  return getTeam(id)
}

export async function deleteTeam(id: string): Promise<boolean> {
  const r = await pool.query('DELETE FROM teams WHERE id = $1', [id])
  return (r.rowCount ?? 0) > 0
}

/**
 * Teams visible to the user — those they are a member of.
 * Returns role + member_count for each team.
 */
export async function listTeamsForUser(userId: string): Promise<TeamSummary[]> {
  const { rows } = await pool.query(
    `SELECT t.*,
            m.role AS my_role,
            (SELECT COUNT(*)::int FROM team_members tm WHERE tm.team_id = t.id) AS member_count
       FROM teams t
       JOIN team_members m ON m.team_id = t.id AND m.user_id = $1
      ORDER BY t.created_at DESC`,
    [userId],
  )
  return rows as TeamSummary[]
}

export async function getTeamMembership(
  teamId: string,
  userId: string,
): Promise<TeamMember | null> {
  const { rows } = await pool.query(
    'SELECT * FROM team_members WHERE team_id = $1 AND user_id = $2',
    [teamId, userId],
  )
  return (rows[0] as TeamMember) ?? null
}

export async function listTeamMembers(teamId: string): Promise<TeamMemberWithUser[]> {
  const { rows } = await pool.query(
    `SELECT m.*, u.display_name AS user_name
       FROM team_members m
       JOIN users u ON u.id = m.user_id
      WHERE m.team_id = $1
      ORDER BY m.joined_at ASC`,
    [teamId],
  )
  return rows as TeamMemberWithUser[]
}

export async function addTeamMember(
  teamId: string,
  userId: string,
  role: TeamRole = 'member',
): Promise<void> {
  await pool.query(
    `INSERT INTO team_members (team_id, user_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (team_id, user_id) DO NOTHING`,
    [teamId, userId, role],
  )
}

export async function updateTeamMemberRole(
  teamId: string,
  userId: string,
  role: TeamRole,
): Promise<boolean> {
  const r = await pool.query(
    'UPDATE team_members SET role = $3 WHERE team_id = $1 AND user_id = $2',
    [teamId, userId, role],
  )
  return (r.rowCount ?? 0) > 0
}

export async function removeTeamMember(teamId: string, userId: string): Promise<boolean> {
  const r = await pool.query('DELETE FROM team_members WHERE team_id = $1 AND user_id = $2', [
    teamId,
    userId,
  ])
  return (r.rowCount ?? 0) > 0
}
