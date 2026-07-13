import { hash as argon2Hash } from '@node-rs/argon2'
import { Hono } from 'hono'
import type { AppEnv } from '../../lib/types'
import { pool } from '../../services/db/pool'
import {
  createUser,
  deleteUser,
  getUser,
  getUserByUsername,
  setUserPassword,
} from '../../services/db/users'

const users = new Hono<AppEnv>()

// Whitelist of sortable columns → SQL expression. Guards against injection:
// the query param is only ever used as a lookup key here, never interpolated.
const USER_SORT_COLUMNS: Record<string, string> = {
  tokens: 'tokens',
  interactions: 'interactions',
  agents: 'agent_count',
  name: 'display_name',
  created: 'created_at',
  last_active: 'last_active_at',
}

// Paginated, sortable, searchable user list with per-user analytics
// (owned-agent count, lifetime interactions, lifetime tokens, last activity).
// Interactions/tokens come from the admin_* matviews (refreshed by the
// scheduler cron); the aggregates are computed independently so joining
// workspaces × sessions never fans out and double-counts a matview row.
users.get('/', async (c) => {
  const q = (c.req.query('q') ?? '').trim()
  const sortCol = USER_SORT_COLUMNS[c.req.query('sort') ?? ''] ?? 'tokens'
  const order = c.req.query('order') === 'asc' ? 'ASC' : 'DESC'
  const page = Math.max(1, Number(c.req.query('page')) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(c.req.query('pageSize')) || 10))
  const offset = (page - 1) * pageSize

  const params: unknown[] = []
  let where = "WHERE role != 'system'"
  if (q) {
    params.push(`%${q}%`)
    where += ` AND (username ILIKE $1 OR display_name ILIKE $1 OR coalesce(email, '') ILIKE $1)`
  }

  const countRes = await pool.query(`SELECT count(*)::int AS total FROM users ${where}`, params)
  const total = countRes.rows[0].total as number

  const limitIdx = params.length + 1
  const offsetIdx = params.length + 2
  const rowsRes = await pool.query(
    `WITH filtered AS (
       SELECT id, username, display_name, email, role, password_hash, created_at, last_login_at
       FROM users ${where}
     ),
     ws_agg AS (
       SELECT w.user_id,
              count(*)::int AS agent_count,
              coalesce(sum(ws.interactions), 0)::int AS interactions
       FROM workspaces w
       LEFT JOIN admin_workspace_stats ws ON ws.workspace_id = w.id
       GROUP BY w.user_id
     ),
     act AS (
       SELECT w.user_id, max(s.last_active_at) AS last_active_at
       FROM workspaces w
       JOIN sessions s ON s.workspace_id = w.id
       GROUP BY w.user_id
     )
     SELECT f.id, f.username, f.display_name, f.email, f.role,
            CASE WHEN f.password_hash IS NOT NULL THEN 'password' ELSE 'ldap' END AS auth_source,
            f.created_at, f.last_login_at,
            coalesce(wa.agent_count, 0)::int AS agent_count,
            coalesce(wa.interactions, 0)::int AS interactions,
            coalesce(tu.input_tokens + tu.output_tokens + tu.cache_read_tokens + tu.cache_creation_tokens, 0)::bigint AS tokens,
            act.last_active_at
     FROM filtered f
     LEFT JOIN ws_agg wa ON wa.user_id = f.id
     LEFT JOIN act ON act.user_id = f.id
     LEFT JOIN admin_token_user_stats tu ON tu.user_id = f.id
     ORDER BY ${sortCol} ${order} NULLS LAST, f.id ASC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    [...params, pageSize, offset],
  )

  return c.json({
    items: rowsRes.rows.map((r) => ({
      id: r.id,
      username: r.username,
      display_name: r.display_name,
      email: r.email,
      role: r.role,
      auth_source: r.auth_source,
      created_at: r.created_at,
      last_login_at: r.last_login_at,
      agent_count: r.agent_count,
      interactions: r.interactions,
      tokens: Number(r.tokens),
      last_active_at: r.last_active_at,
    })),
    total,
    page,
    pageSize,
  })
})

users.post('/', async (c) => {
  const body = await c.req.json<{
    username: string
    display_name: string
    password: string
    email?: string
    role?: 'user' | 'admin'
  }>()

  if (!body.username || !body.display_name || !body.password) {
    return c.json({ error: 'username, display_name, and password are required' }, 400)
  }

  if (body.password.length < 6) {
    return c.json({ error: 'Password must be at least 6 characters' }, 400)
  }

  const existing = await getUserByUsername(body.username)
  if (existing) {
    return c.json({ error: 'Username already exists' }, 409)
  }

  const passwordHash = await argon2Hash(body.password)
  const user = await createUser(
    body.username,
    body.display_name,
    passwordHash,
    body.email,
    body.role,
  )
  return c.json({ id: user.id, username: user.username }, 201)
})

users.put('/:id/password', async (c) => {
  const userId = c.req.param('id')
  const { password } = await c.req.json<{ password: string }>()

  if (!password || password.length < 6) {
    return c.json({ error: 'Password must be at least 6 characters' }, 400)
  }

  const user = await getUser(userId)
  if (!user) {
    return c.json({ error: 'User not found' }, 404)
  }

  if (!user.password_hash) {
    return c.json({ error: 'Cannot set password for LDAP users' }, 400)
  }

  const passwordHash = await argon2Hash(password)
  await setUserPassword(userId, passwordHash)
  return c.json({ success: true })
})

users.delete('/:id', async (c) => {
  const userId = c.req.param('id')
  const currentUser = c.get('user')

  if (userId === currentUser.sub) {
    return c.json({ error: 'Cannot delete yourself' }, 400)
  }

  const user = await getUser(userId)
  if (!user) {
    return c.json({ error: 'User not found' }, 404)
  }

  // LDAP users are deletable too (admin request): removing the local row is a
  // cleanup — an active LDAP user re-provisions on next login. Password reset
  // stays password-only (no local secret to set for LDAP), but delete does not.
  await deleteUser(userId)
  return c.json({ success: true })
})

export default users
