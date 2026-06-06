import { randomBytes } from 'node:crypto'
import { pool } from './pool'

interface TeamInvite {
  token: string
  team_id: string
  created_by: string
  expires_at: Date | null
  created_at: Date
}

function generateToken(): string {
  return `tinv_${randomBytes(24).toString('base64url')}`
}

export async function createTeamInvite(
  teamId: string,
  createdBy: string,
  expiresAt: Date | null,
): Promise<TeamInvite> {
  const token = generateToken()
  await pool.query(
    `INSERT INTO team_invites (token, team_id, created_by, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [token, teamId, createdBy, expiresAt],
  )
  return (await getTeamInviteByToken(token))!
}

export async function getTeamInviteByToken(token: string): Promise<TeamInvite | null> {
  const { rows } = await pool.query('SELECT * FROM team_invites WHERE token = $1', [token])
  return (rows[0] as TeamInvite) ?? null
}

export async function listTeamInvites(teamId: string): Promise<TeamInvite[]> {
  const { rows } = await pool.query(
    `SELECT * FROM team_invites
      WHERE team_id = $1 AND (expires_at IS NULL OR expires_at > now())
      ORDER BY created_at DESC`,
    [teamId],
  )
  return rows as TeamInvite[]
}

export async function deleteTeamInvite(token: string): Promise<boolean> {
  const r = await pool.query('DELETE FROM team_invites WHERE token = $1', [token])
  return (r.rowCount ?? 0) > 0
}
