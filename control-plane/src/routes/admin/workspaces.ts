import { Hono } from 'hono'
import type { AppEnv } from '../../lib/types'
import { pool } from '../../services/db/pool'
import { getWorkspace } from '../../services/db/workspaces'
import { destroyWorkspace, stopWorkspace } from '../../services/workspace-lifecycle'

const workspaces = new Hono<AppEnv>()

// Whitelist of sortable columns → SQL expression. The query param is only ever
// a lookup key here, never interpolated, so this guards against injection.
const WS_SORT_COLUMNS: Record<string, string> = {
  tokens: 'tokens',
  interactions: 'interactions',
  last_active: 'last_active_at',
  created: 'created_at',
  name: 'name',
  status: 'status',
}

const WS_STATUSES = new Set(['running', 'stopped', 'error'])

// Global, paginated, sortable, searchable workspace list across all owners.
// Read-only fleet view: owner, status, agent type, and usage aggregates
// (interactions/tokens from the admin_* matviews, last activity from sessions).
// Deliberately exposes NO session/message content — admin privacy red line.
workspaces.get('/', async (c) => {
  const q = (c.req.query('q') ?? '').trim()
  const status = c.req.query('status') ?? ''
  const agentType = c.req.query('agentType') ?? ''
  const ownerId = c.req.query('ownerId') ?? ''
  const sortCol = WS_SORT_COLUMNS[c.req.query('sort') ?? ''] ?? 'tokens'
  const order = c.req.query('order') === 'asc' ? 'ASC' : 'DESC'
  const page = Math.max(1, Number(c.req.query('page')) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(c.req.query('pageSize')) || 10))
  const offset = (page - 1) * pageSize

  // Exclude internal/system workspaces from the fleet view.
  const conds: string[] = ['w.is_system = false']
  const params: unknown[] = []
  if (status && WS_STATUSES.has(status)) {
    params.push(status)
    conds.push(`w.status = $${params.length}`)
  }
  if (agentType) {
    params.push(agentType)
    conds.push(`cfg.agent_type = $${params.length}`)
  }
  if (ownerId) {
    params.push(ownerId)
    conds.push(`w.user_id = $${params.length}`)
  }
  if (q) {
    params.push(`%${q}%`)
    conds.push(
      `(w.name ILIKE $${params.length} OR u.display_name ILIKE $${params.length} OR u.username ILIKE $${params.length})`,
    )
  }
  const where = `WHERE ${conds.join(' AND ')}`

  const joins = `
    FROM workspaces w
    JOIN users u ON u.id = w.user_id
    LEFT JOIN workspace_config cfg ON cfg.workspace_id = w.id`

  const countRes = await pool.query(`SELECT count(*)::int AS total ${joins} ${where}`, params)
  const total = countRes.rows[0].total as number

  const limitIdx = params.length + 1
  const offsetIdx = params.length + 2
  const rowsRes = await pool.query(
    `SELECT w.id, w.name, w.status, w.created_at,
            w.user_id AS owner_id, u.display_name AS owner, u.username AS owner_username,
            coalesce(cfg.agent_type, '') AS agent_type,
            coalesce(ws.interactions, 0)::int AS interactions,
            coalesce(tw.input_tokens + tw.output_tokens + tw.cache_read_tokens + tw.cache_creation_tokens, 0)::bigint AS tokens,
            act.last_active_at
     ${joins}
     LEFT JOIN admin_workspace_stats ws ON ws.workspace_id = w.id
     LEFT JOIN admin_token_workspace_stats tw ON tw.workspace_id = w.id
     LEFT JOIN (
       SELECT workspace_id, max(last_active_at) AS last_active_at
       FROM sessions GROUP BY workspace_id
     ) act ON act.workspace_id = w.id
     ${where}
     ORDER BY ${sortCol} ${order} NULLS LAST, w.id ASC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    [...params, pageSize, offset],
  )

  return c.json({
    items: rowsRes.rows.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      owner_id: r.owner_id,
      owner: r.owner,
      owner_username: r.owner_username,
      agent_type: r.agent_type,
      interactions: r.interactions,
      tokens: Number(r.tokens),
      last_active_at: r.last_active_at,
      created_at: r.created_at,
    })),
    total,
    page,
    pageSize,
  })
})

// Admin stop: reversible scale-down of any workspace (auth is the admin
// middleware; no ownership check). Shares the exact orchestration the owner
// stop route uses, so behaviour can't drift.
workspaces.post('/:id/stop', async (c) => {
  const id = c.req.param('id')
  const workspace = await getWorkspace(id)
  if (!workspace) {
    return c.json({ error: 'Workspace not found' }, 404)
  }
  try {
    console.log(`[Admin] Stop workspace=${id}`)
    await stopWorkspace(workspace)
    return c.json({ success: true })
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Failed to stop workspace' }, 500)
  }
})

// Admin delete: tears down any workspace and its instance via the same shared
// orchestration as the owner delete route.
workspaces.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const workspace = await getWorkspace(id)
  if (!workspace) {
    return c.json({ error: 'Workspace not found' }, 404)
  }
  try {
    console.log(`[Admin] Delete workspace=${id}`)
    await destroyWorkspace(workspace)
    return c.json({ success: true })
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Failed to delete workspace' }, 500)
  }
})

export default workspaces
