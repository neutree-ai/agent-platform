// Users an application provisions and acts for (migrations/149_app_managed_users.sql).
//
// The application names each user by its own id (`external_id`); that id is
// stored in user_identities under the provider `app:<client_id>`, so two apps
// can use the same external id for different people without colliding.

import { generateId, pool } from './pool'
import { addTeamMember, removeTeamMember } from './teams'
import type { User } from './types'

function appIdentityProvider(clientId: string): string {
  return `app:${clientId}`
}

export async function getAppUser(clientId: string, externalId: string): Promise<User | null> {
  const { rows } = await pool.query(
    `SELECT u.* FROM user_identities i
       JOIN users u ON u.id = i.user_id
      WHERE i.provider = $1 AND i.external_id = $2 AND u.managed_by = $3`,
    [appIdentityProvider(clientId), externalId, clientId],
  )
  return (rows[0] as User) ?? null
}

/**
 * Create the user, or update its name and email if it already exists, then
 * make it a member of the application's declared teams. Safe to call on every
 * request: concurrent calls for the same external id resolve to one user.
 */
export async function upsertAppUser(
  clientId: string,
  externalId: string,
  displayName: string,
  email: string | null,
): Promise<{ user: User; created: boolean }> {
  let created = false
  let user = await getAppUser(clientId, externalId)
  if (user) {
    await pool.query('UPDATE users SET display_name = $1, email = $2 WHERE id = $3', [
      displayName,
      email,
      user.id,
    ])
  } else {
    const id = generateId()
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `INSERT INTO users (id, username, display_name, email, managed_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, `${clientId}:${externalId}`, displayName, email, clientId],
      )
      const { rowCount } = await client.query(
        `INSERT INTO user_identities (user_id, provider, external_id, display_name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (provider, external_id) DO NOTHING`,
        [id, appIdentityProvider(clientId), externalId, displayName],
      )
      // Lost the race to a concurrent call: drop our row, use theirs.
      await client.query(rowCount ? 'COMMIT' : 'ROLLBACK')
      created = !!rowCount
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  user = await getAppUser(clientId, externalId)
  if (!user) throw new Error(`app user ${clientId}/${externalId} vanished during upsert`)
  for (const teamId of await listClientTeamIds(clientId)) {
    await addTeamMember(teamId, user.id)
  }
  return { user, created }
}

async function listClientTeamIds(clientId: string): Promise<string[]> {
  const { rows } = await pool.query(
    'SELECT team_id FROM oauth_client_teams WHERE client_id = $1 ORDER BY team_id',
    [clientId],
  )
  return rows.map((r) => r.team_id as string)
}

/** The ids in `teamIds` that don't name an existing team. */
export async function unknownTeamIds(teamIds: string[]): Promise<string[]> {
  if (teamIds.length === 0) return []
  const { rows } = await pool.query('SELECT id FROM teams WHERE id = ANY($1)', [teamIds])
  const found = new Set(rows.map((r) => r.id as string))
  return teamIds.filter((id) => !found.has(id))
}

/**
 * Replace the application's declared teams and bring every one of its users
 * in line: members of the teams added, removed from the teams dropped.
 * Check the ids with unknownTeamIds first.
 */
export async function setClientTeams(clientId: string, teamIds: string[]): Promise<void> {
  const wanted = [...new Set(teamIds)]
  const current = await listClientTeamIds(clientId)
  const added = wanted.filter((id) => !current.includes(id))
  const dropped = current.filter((id) => !wanted.includes(id))

  await pool.query('DELETE FROM oauth_client_teams WHERE client_id = $1', [clientId])
  if (wanted.length > 0) {
    await pool.query(
      `INSERT INTO oauth_client_teams (client_id, team_id)
       SELECT $1, unnest($2::text[])`,
      [clientId, wanted],
    )
  }

  if (added.length > 0 || dropped.length > 0) {
    const { rows } = await pool.query('SELECT id FROM users WHERE managed_by = $1', [clientId])
    for (const { id: userId } of rows as { id: string }[]) {
      for (const teamId of added) await addTeamMember(teamId, userId)
      for (const teamId of dropped) await removeTeamMember(teamId, userId)
    }
  }
}

/** The application that declared an MCP origin, if any. */
export async function getMcpOriginClient(origin: string): Promise<string | null> {
  const { rows } = await pool.query(
    'SELECT client_id FROM oauth_client_mcp_origins WHERE origin = $1',
    [origin],
  )
  return (rows[0]?.client_id as string) ?? null
}

/**
 * The application that declared an MCP origin, with its own id for `userId`
 * when it provisioned that user. Null when no application declared the origin.
 */
export async function getMcpOriginCaller(
  origin: string,
  userId: string,
): Promise<{ clientId: string; externalId: string | null } | null> {
  const { rows } = await pool.query(
    `SELECT o.client_id, i.external_id
       FROM oauth_client_mcp_origins o
       LEFT JOIN users u ON u.id = $2 AND u.managed_by = o.client_id
       -- the provider appIdentityProvider() names
       LEFT JOIN user_identities i ON i.user_id = u.id AND i.provider = 'app:' || o.client_id
      WHERE o.origin = $1`,
    [origin, userId],
  )
  const row = rows[0]
  return row ? { clientId: row.client_id, externalId: row.external_id ?? null } : null
}

/** The origins in `origins` another application already declared. */
export async function mcpOriginsTakenByOthers(
  clientId: string,
  origins: string[],
): Promise<string[]> {
  if (origins.length === 0) return []
  const { rows } = await pool.query(
    'SELECT origin FROM oauth_client_mcp_origins WHERE origin = ANY($1) AND client_id <> $2',
    [origins, clientId],
  )
  return rows.map((r) => r.origin as string)
}

/** Replace the application's declared MCP origins. Check them with mcpOriginsTakenByOthers first. */
export async function setClientMcpOrigins(clientId: string, origins: string[]): Promise<void> {
  await pool.query('DELETE FROM oauth_client_mcp_origins WHERE client_id = $1', [clientId])
  if (origins.length > 0) {
    await pool.query(
      `INSERT INTO oauth_client_mcp_origins (origin, client_id)
       SELECT unnest($2::text[]), $1`,
      [clientId, origins],
    )
  }
}
