import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { generateId } from '../lib/id'

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://tos:tos@localhost:5432/tos',
})

// --- Migrations ---

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  const { rows } = await pool.query('SELECT id FROM schema_migrations ORDER BY id')
  const applied = new Set(rows.map((r: { id: string }) => r.id))

  const migrationsDir = join(process.cwd(), 'migrations')
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  let newCount = 0
  for (const file of files) {
    const id = `channel_${file.replace('.sql', '')}`
    if (applied.has(id)) continue

    const sql = readFileSync(join(migrationsDir, file), 'utf-8')
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [id])
      await client.query('COMMIT')
      console.log(`[channel-db] migration applied: ${file}`)
      newCount++
    } catch (e) {
      await client.query('ROLLBACK')
      console.error(`[channel-db] migration failed: ${file}`, e)
      throw e
    } finally {
      client.release()
    }
  }
  console.log(`[channel-db] migrations: ${applied.size} existing, ${newCount} new, ${files.length} total`)
}

// --- Connectors ---

export interface Connector {
  id: string
  user_id: string
  type: string
  name: string
  credentials: Record<string, unknown>
  config: Record<string, unknown>
  is_public: boolean
  enabled: boolean
  created_at: string
  updated_at: string
}

export async function createConnector(data: {
  user_id: string
  type: string
  name: string
  credentials?: Record<string, unknown>
  config?: Record<string, unknown>
  is_public?: boolean
}): Promise<Connector> {
  const id = generateId()
  const { rows } = await pool.query(
    `INSERT INTO channel.connectors (id, user_id, type, name, credentials, config, is_public)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [id, data.user_id, data.type, data.name, JSON.stringify(data.credentials || {}), JSON.stringify(data.config || {}), data.is_public ?? false],
  )
  return rows[0]
}

export async function listConnectors(user_id: string): Promise<Connector[]> {
  const { rows } = await pool.query(
    'SELECT * FROM channel.connectors WHERE user_id = $1 OR is_public = true ORDER BY created_at DESC',
    [user_id],
  )
  return rows
}

export async function getConnector(id: string, user_id?: string): Promise<Connector | null> {
  if (user_id) {
    const { rows } = await pool.query(
      'SELECT * FROM channel.connectors WHERE id = $1 AND (user_id = $2 OR is_public = true)',
      [id, user_id],
    )
    return rows[0] || null
  }
  const { rows } = await pool.query('SELECT * FROM channel.connectors WHERE id = $1', [id])
  return rows[0] || null
}

export async function getConnectorsByType(type: string): Promise<Connector[]> {
  const { rows } = await pool.query(
    'SELECT * FROM channel.connectors WHERE type = $1 AND enabled = true ORDER BY created_at',
    [type],
  )
  return rows
}

export async function updateConnector(
  id: string,
  user_id: string,
  data: { name?: string; credentials?: Record<string, unknown>; config?: Record<string, unknown>; enabled?: boolean; is_public?: boolean },
): Promise<Connector | null> {
  const fields: string[] = []
  const values: unknown[] = []
  let idx = 1

  if (data.name !== undefined) {
    fields.push(`name = $${idx++}`)
    values.push(data.name)
  }
  if (data.credentials !== undefined) {
    fields.push(`credentials = credentials || $${idx++}::jsonb`)
    values.push(JSON.stringify(data.credentials))
  }
  if (data.config !== undefined) {
    fields.push(`config = $${idx++}`)
    values.push(JSON.stringify(data.config))
  }
  if (data.enabled !== undefined) {
    fields.push(`enabled = $${idx++}`)
    values.push(data.enabled)
  }
  if (data.is_public !== undefined) {
    fields.push(`is_public = $${idx++}`)
    values.push(data.is_public)
  }

  if (fields.length === 0) return getConnector(id, user_id)

  fields.push(`updated_at = NOW()`)
  values.push(id)
  values.push(user_id)

  const { rows } = await pool.query(
    `UPDATE channel.connectors SET ${fields.join(', ')} WHERE id = $${idx++} AND user_id = $${idx} RETURNING *`,
    values,
  )
  return rows[0] || null
}

export async function deleteConnector(id: string, user_id: string): Promise<boolean> {
  const { rowCount } = await pool.query('DELETE FROM channel.connectors WHERE id = $1 AND user_id = $2', [id, user_id])
  return (rowCount ?? 0) > 0
}

export async function listRelayConnectors(): Promise<Connector[]> {
  const { rows } = await pool.query(
    "SELECT * FROM channel.connectors WHERE type = 'webhook-relay' AND enabled = true ORDER BY created_at",
  )
  return rows
}

// --- Platform tokens (shared DB with control-plane) ---

export async function getPlatformToken(userId: string): Promise<string | null> {
  const { rows } = await pool.query(
    'SELECT token FROM service_tokens WHERE created_by = $1 AND is_platform = true AND revoked_at IS NULL',
    [userId],
  )
  return rows[0]?.token ?? null
}

// --- Routes ---

export interface Route {
  id: string
  user_id: string
  connector_id: string
  external_id: string
  workspace_id: string
  name: string | null
  config: Record<string, unknown>
  enabled: boolean
  created_at: string
  updated_at: string
  // joined fields
  connector_type?: string
  connector_name?: string
}

const ROUTE_SELECT = `
  SELECT r.*, c.type AS connector_type, c.name AS connector_name
  FROM channel.routes r
  LEFT JOIN channel.connectors c ON c.id = r.connector_id
`

export async function createRoute(data: {
  user_id: string
  connector_id: string
  external_id: string
  workspace_id: string
  name?: string
  config?: Record<string, unknown>
}): Promise<Route> {
  const id = generateId()
  const { rows } = await pool.query(
    `INSERT INTO channel.routes (id, user_id, connector_id, external_id, workspace_id, name, config)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [id, data.user_id, data.connector_id, data.external_id, data.workspace_id, data.name || null, JSON.stringify(data.config || {})],
  )
  return rows[0]
}

export async function listRoutes(user_id: string, connector_id?: string): Promise<Route[]> {
  if (connector_id) {
    const { rows } = await pool.query(
      `${ROUTE_SELECT} WHERE r.user_id = $1 AND r.connector_id = $2 ORDER BY r.created_at DESC`,
      [user_id, connector_id],
    )
    return rows
  }
  const { rows } = await pool.query(`${ROUTE_SELECT} WHERE r.user_id = $1 ORDER BY r.created_at DESC`, [user_id])
  return rows
}

export async function getRoute(id: string, user_id?: string): Promise<Route | null> {
  if (user_id) {
    const { rows } = await pool.query(`${ROUTE_SELECT} WHERE r.id = $1 AND r.user_id = $2`, [id, user_id])
    return rows[0] || null
  }
  const { rows } = await pool.query(`${ROUTE_SELECT} WHERE r.id = $1`, [id])
  return rows[0] || null
}

export async function getRouteByExternalId(connectorId: string, externalId: string): Promise<Route | null> {
  const { rows } = await pool.query(
    `${ROUTE_SELECT} WHERE r.connector_id = $1 AND r.external_id = $2 AND r.enabled = true`,
    [connectorId, externalId],
  )
  return rows[0] || null
}

export async function updateRoute(
  id: string,
  user_id: string,
  data: { name?: string; workspace_id?: string; config?: Record<string, unknown>; enabled?: boolean },
): Promise<Route | null> {
  const fields: string[] = []
  const values: unknown[] = []
  let idx = 1

  if (data.name !== undefined) {
    fields.push(`name = $${idx++}`)
    values.push(data.name)
  }
  if (data.workspace_id !== undefined) {
    fields.push(`workspace_id = $${idx++}`)
    values.push(data.workspace_id)
  }
  if (data.config !== undefined) {
    fields.push(`config = $${idx++}`)
    values.push(JSON.stringify(data.config))
  }
  if (data.enabled !== undefined) {
    fields.push(`enabled = $${idx++}`)
    values.push(data.enabled)
  }

  if (fields.length === 0) return getRoute(id, user_id)

  fields.push(`updated_at = NOW()`)
  values.push(id)
  values.push(user_id)

  const { rows } = await pool.query(
    `UPDATE channel.routes SET ${fields.join(', ')} WHERE id = $${idx++} AND user_id = $${idx} RETURNING *`,
    values,
  )
  return rows[0] || null
}

export async function deleteRoute(id: string, user_id: string): Promise<boolean> {
  const { rowCount } = await pool.query('DELETE FROM channel.routes WHERE id = $1 AND user_id = $2', [id, user_id])
  return (rowCount ?? 0) > 0
}

// --- Event Log ---

interface EventLog {
  id: string
  route_id: string | null
  connector_id: string | null
  event_type: string
  payload: unknown
  job_id: string | null
  status: string
  error: string | null
  created_at: string
  // joined fields
  connector_type?: string
  job_state?: string | null
  job_started_on?: string | null
  job_completed_on?: string | null
  job_retry_count?: number | null
}

export async function logEvent(data: {
  route_id?: string
  connector_id: string
  event_type: string
  payload?: unknown
  job_id?: string
  status?: string
  error?: string
  dedup_key?: string
}): Promise<EventLog> {
  const id = generateId()
  const { rows } = await pool.query(
    `INSERT INTO channel.event_log (id, route_id, connector_id, event_type, payload, job_id, status, error, dedup_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [
      id,
      data.route_id || null,
      data.connector_id,
      data.event_type,
      data.payload ? JSON.stringify(data.payload) : null,
      data.job_id || null,
      data.status || 'success',
      data.error || null,
      data.dedup_key || null,
    ],
  )
  return rows[0]
}

/** Check if an event with this dedup key already exists. */
export async function eventExistsByDedupKey(dedupKey: string): Promise<boolean> {
  const { rows } = await pool.query(
    'SELECT 1 FROM channel.event_log WHERE dedup_key = $1 LIMIT 1',
    [dedupKey],
  )
  return rows.length > 0
}

/**
 * Atomically claim a dedup slot. Returns the event ID if claimed, null if
 * another handler already owns this dedup_key (unique index).
 */
export async function claimEvent(data: {
  route_id?: string
  connector_id: string
  event_type: string
  payload?: unknown
  dedup_key: string
}): Promise<string | null> {
  const id = generateId()
  const { rowCount } = await pool.query(
    `INSERT INTO channel.event_log (id, route_id, connector_id, event_type, payload, status, dedup_key)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6)
     ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING`,
    [
      id,
      data.route_id || null,
      data.connector_id,
      data.event_type,
      data.payload ? JSON.stringify(data.payload) : null,
      data.dedup_key,
    ],
  )
  return rowCount ? id : null
}

/** Update a previously claimed event with job result. */
export async function updateEvent(
  id: string,
  data: { job_id?: string; status?: string; error?: string },
): Promise<void> {
  await pool.query(
    `UPDATE channel.event_log SET job_id = COALESCE($2, job_id), status = COALESCE($3, status), error = COALESCE($4, error) WHERE id = $1`,
    [id, data.job_id || null, data.status || null, data.error || null],
  )
}

export async function listEvents(opts: {
  user_id: string
  route_id?: string
  connector_id?: string
  limit?: number
  offset?: number
}): Promise<{ events: EventLog[]; total: number }> {
  const limit = opts.limit || 50
  const offset = opts.offset || 0
  const conditions: string[] = []
  const values: unknown[] = []
  let idx = 1

  // Filter events by user's connectors
  conditions.push(`c.user_id = $${idx++}`)
  values.push(opts.user_id)

  if (opts.route_id) {
    conditions.push(`e.route_id = $${idx++}`)
    values.push(opts.route_id)
  }
  if (opts.connector_id) {
    conditions.push(`e.connector_id = $${idx++}`)
    values.push(opts.connector_id)
  }

  const where = `WHERE ${conditions.join(' AND ')}`

  const { rows } = await pool.query(
    `SELECT e.*, c.type AS connector_type,
            j.state AS job_state,
            j.started_on AS job_started_on,
            j.completed_on AS job_completed_on,
            j.retry_count AS job_retry_count
     FROM channel.event_log e
     LEFT JOIN channel.connectors c ON c.id = e.connector_id
     LEFT JOIN pgboss.job j ON j.id::text = e.job_id
     ${where} ORDER BY e.created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
    [...values, limit, offset],
  )

  const {
    rows: [{ count }],
  } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM channel.event_log e
     LEFT JOIN channel.connectors c ON c.id = e.connector_id
     ${where}`,
    values,
  )

  return { events: rows, total: count }
}

// --- Session source lookup ---

// --- Connector metadata (system-managed, separate from user config) ---

export async function updateConnectorMetadata(
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await pool.query(
    'UPDATE channel.connectors SET metadata = metadata || $1::jsonb WHERE id = $2',
    [JSON.stringify(patch), id],
  )
}

// --- Session source lookup ---

export interface SessionSource {
  connector_type: string
  connector_name: string
  connector_metadata: Record<string, unknown>
  channel_id: string
  thread_id: string
  route_name: string | null
  workspace_id: string
}

/** Get the last_active_at as Unix epoch string for a thread session (used as cursor for incremental Slack context). */
export async function getThreadSessionCursor(
  routeId: string,
  threadId: string,
): Promise<string | null> {
  const { rows } = await pool.query(
    `SELECT EXTRACT(EPOCH FROM last_active_at)::text AS cursor_ts FROM channel.thread_sessions
     WHERE route_id = $1 AND external_thread_id = $2`,
    [routeId, threadId],
  )
  return rows[0]?.cursor_ts ?? null
}

/** Delete the thread_sessions row so the next message starts a fresh session.
 *  Returns true if a row was deleted. */
export async function deleteThreadSession(
  routeId: string,
  threadId: string,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM channel.thread_sessions WHERE route_id = $1 AND external_thread_id = $2`,
    [routeId, threadId],
  )
  return (rowCount ?? 0) > 0
}

export async function getSessionSource(sessionId: string): Promise<SessionSource | null> {
  const { rows } = await pool.query(
    `SELECT c.type AS connector_type, c.name AS connector_name, c.metadata AS connector_metadata,
            COALESCE(ts.external_channel_id, r.external_id) AS channel_id, r.name AS route_name, r.workspace_id,
            ts.external_thread_id AS thread_id
     FROM channel.thread_sessions ts
     JOIN channel.routes r ON r.id = ts.route_id
     JOIN channel.connectors c ON c.id = r.connector_id
     WHERE ts.session_id = $1`,
    [sessionId],
  )
  return rows[0] || null
}
