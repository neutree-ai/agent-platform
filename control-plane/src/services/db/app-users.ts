// Users an application provisions and acts for (migrations/149_app_managed_users.sql).
//
// The application names each user by its own id (`external_id`); that id is
// stored in user_identities under the provider `app:<client_id>`, so two apps
// can use the same external id for different people without colliding.

import type { PoolClient } from 'pg'
import { generateId, pool } from './pool'
import { type Team, addTeamMember } from './teams'
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
 * make it a member of the application's team. Safe to call on every request:
 * concurrent calls for the same external id resolve to one user.
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
  const teamId = await getAppTeamId(clientId)
  if (teamId) await addTeamMember(teamId, user.id)
  return { user, created }
}

/** The id of the application's own team (migrations/152_app_teams.sql). */
export async function getAppTeamId(clientId: string): Promise<string | null> {
  const { rows } = await pool.query('SELECT id FROM teams WHERE app_id = $1', [clientId])
  return (rows[0]?.id as string) ?? null
}

/**
 * Create the application's team, named after it, with whoever registered the
 * application as its admin, and the account the application owns its content
 * under (migrations/153_app_owners.sql), as a member. Runs in the transaction
 * that creates the application; returns the team's id.
 */
export async function createAppAccounts(
  client: PoolClient,
  app: { id: string; name: string; description: string | null; createdBy: string },
): Promise<string> {
  const teamId = generateId()
  const ownerId = generateId()
  await client.query(
    `INSERT INTO teams (id, name, description, created_by, app_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [teamId, app.name, app.description, app.createdBy, app.id],
  )
  await client.query(
    `INSERT INTO users (id, username, display_name, role, managed_by)
     VALUES ($1, $2, $3, 'system', $4)`,
    [ownerId, `app/${app.id}`, app.name, app.id],
  )
  await client.query(
    `INSERT INTO team_members (team_id, user_id, role)
     VALUES ($1, $2, 'admin'), ($1, $3, 'member')`,
    [teamId, app.createdBy, ownerId],
  )
  return teamId
}

/** The account the application owns its prompts and skills under. */
export async function getAppOwnerId(clientId: string): Promise<string> {
  const { rows } = await pool.query(
    "SELECT id FROM users WHERE managed_by = $1 AND role = 'system'",
    [clientId],
  )
  if (!rows[0]) throw new Error(`application ${clientId} has no owner account`)
  return rows[0].id as string
}

/** Keep the application's team and owner account named after it. */
export async function renameAppTeam(
  clientId: string,
  patch: { name?: string; description?: string | null },
): Promise<void> {
  if (patch.name !== undefined) {
    await pool.query('UPDATE teams SET name = $1, updated_at = now() WHERE app_id = $2', [
      patch.name,
      clientId,
    ])
    await pool.query(
      "UPDATE users SET display_name = $1 WHERE managed_by = $2 AND role = 'system'",
      [patch.name, clientId],
    )
  }
  if (patch.description !== undefined) {
    await pool.query('UPDATE teams SET description = $1, updated_at = now() WHERE app_id = $2', [
      patch.description,
      clientId,
    ])
  }
}

// Teams the application creates for its users (migrations/158_app_owned_teams.sql),
// named by the application's own id for each.

export async function getAppOwnedTeam(clientId: string, externalId: string): Promise<Team | null> {
  const { rows } = await pool.query(
    'SELECT * FROM teams WHERE owner_app_id = $1 AND external_id = $2',
    [clientId, externalId],
  )
  return (rows[0] as Team) ?? null
}

/** Create the team, or set its name and description if it already exists. */
export async function upsertAppOwnedTeam(
  clientId: string,
  externalId: string,
  name: string,
  description: string | null,
): Promise<{ team: Team; created: boolean }> {
  const { rows } = await pool.query(
    `INSERT INTO teams (id, name, description, created_by, owner_app_id, external_id)
     SELECT $1, $2, $3, c.created_by, c.id, $5
       FROM oauth_clients c WHERE c.id = $4
     ON CONFLICT (owner_app_id, external_id) WHERE owner_app_id IS NOT NULL
     DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, updated_at = now()
     RETURNING *, (xmax = 0) AS created`,
    [generateId(), name, description, clientId, externalId],
  )
  if (!rows[0]) throw new Error(`application ${clientId} not found`)
  const { created, ...team } = rows[0] as Team & { created: boolean }
  return { team, created }
}

export async function listAppOwnedTeams(
  clientId: string,
): Promise<(Team & { member_count: number })[]> {
  const { rows } = await pool.query(
    `SELECT t.*,
            (SELECT COUNT(*)::int FROM team_members m WHERE m.team_id = t.id) AS member_count
       FROM teams t
      WHERE t.owner_app_id = $1
      ORDER BY t.created_at ASC`,
    [clientId],
  )
  return rows as (Team & { member_count: number })[]
}

/** The members of one of the application's teams, with the application's own id for each. */
export async function listAppOwnedTeamMembers(
  clientId: string,
  teamId: string,
): Promise<{ user: User; externalId: string }[]> {
  const { rows } = await pool.query(
    `SELECT u.*, i.external_id AS app_external_id
       FROM team_members m
       JOIN users u ON u.id = m.user_id AND u.managed_by = $1
       JOIN user_identities i ON i.user_id = u.id AND i.provider = $3
      WHERE m.team_id = $2
      ORDER BY m.joined_at ASC`,
    [clientId, teamId, appIdentityProvider(clientId)],
  )
  return rows.map(({ app_external_id, ...user }) => ({
    user: user as User,
    externalId: app_external_id as string,
  }))
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

/**
 * Replace the application's declared MCP origins, inside the caller's
 * transaction. Check them with mcpOriginsTakenByOthers first.
 */
export async function setClientMcpOrigins(
  client: PoolClient,
  clientId: string,
  origins: string[],
): Promise<void> {
  await client.query('DELETE FROM oauth_client_mcp_origins WHERE client_id = $1', [clientId])
  if (origins.length > 0) {
    await client.query(
      `INSERT INTO oauth_client_mcp_origins (origin, client_id)
       SELECT unnest($2::text[]), $1`,
      [clientId, origins],
    )
  }
}
