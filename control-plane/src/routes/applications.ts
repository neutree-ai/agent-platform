import { createHash, randomBytes } from 'node:crypto'
import { Hono } from 'hono'
import type { ApiApplication } from '../../../internal/types/api'
import {
  ApplicationCreateBodySchema,
  ApplicationUpdateBodySchema,
} from '../../../internal/types/api'
import type { AppEnv } from '../lib/types'
import { generateId, pool } from '../services/db/pool'

const applications = new Hono<AppEnv>()

function generateClientSecret(): string {
  return `tos_cs_${randomBytes(32).toString('hex')}`
}

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

function requireAdmin(user: { role: string } | undefined) {
  return user?.role === 'admin'
}

function sanitizeHttpUrl(input: unknown): { ok: true; value: string | null } | { ok: false } {
  if (input === null || input === undefined) return { ok: true, value: null }
  if (typeof input !== 'string') return { ok: false }
  const trimmed = input.trim()
  if (!trimmed) return { ok: true, value: null }
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false }
  } catch {
    return { ok: false }
  }
  return { ok: true, value: trimmed }
}

function sanitizeRedirectUris(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null
  const uris: string[] = []
  for (const raw of input) {
    if (typeof raw !== 'string') return null
    const trimmed = raw.trim()
    if (!trimmed) continue
    try {
      const url = new URL(trimmed)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    } catch {
      return null
    }
    uris.push(trimmed)
  }
  if (uris.length === 0) return null
  return uris
}

// GET /api/applications — list (all authenticated users, read-only view)
applications.get('/', async (c) => {
  const { rows } = await pool.query<ApiApplication>(
    `SELECT c.id, c.name, c.description, c.homepage_url, c.redirect_uris,
            c.created_by, c.created_at, c.updated_at,
            u.display_name AS owner_display_name, u.username AS owner_username
       FROM oauth_clients c
       LEFT JOIN users u ON u.id = c.created_by
       ORDER BY c.created_at`,
  )
  return c.json(rows)
})

// POST /api/applications — admin only; returns one-time plaintext secret
applications.post('/', async (c) => {
  const user = c.get('user')
  if (!requireAdmin(user)) return c.json({ error: 'Forbidden' }, 403)

  const parsed = ApplicationCreateBodySchema.safeParse(await c.req.json())
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? 'invalid body' }, 400)
  }
  const body = parsed.data

  const name = body.name.trim()
  if (!name) return c.json({ error: 'name is required' }, 400)

  const redirectUris = sanitizeRedirectUris(body.redirect_uris)
  if (!redirectUris) {
    return c.json({ error: 'redirect_uris must be a non-empty array of http(s) URLs' }, 400)
  }

  const homepage = sanitizeHttpUrl(body.homepage_url)
  if (!homepage.ok) {
    return c.json({ error: 'homepage_url must be an http(s) URL' }, 400)
  }

  // Custom id optional; must be slug-like to be URL-safe, otherwise auto-generate
  let id = body.id?.trim() || ''
  if (id) {
    if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(id)) {
      return c.json(
        { error: 'id must be 3–64 chars of lowercase letters, digits, or hyphens' },
        400,
      )
    }
  } else {
    id = `app_${generateId()}`
  }

  const description = typeof body.description === 'string' ? body.description.trim() || null : null
  const secret = generateClientSecret()
  const secretHash = hashSecret(secret)

  try {
    await pool.query(
      `INSERT INTO oauth_clients (id, name, description, homepage_url, secret_hash, redirect_uris, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, name, description, homepage.value, secretHash, redirectUris, user.sub],
    )
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      return c.json({ error: 'id already exists' }, 409)
    }
    throw err
  }

  return c.json(
    {
      id,
      name,
      description,
      homepage_url: homepage.value,
      redirect_uris: redirectUris,
      client_secret: secret,
    },
    201,
  )
})

// PATCH /api/applications/:id — admin only; update name/description/redirect_uris
applications.patch('/:id', async (c) => {
  const user = c.get('user')
  if (!requireAdmin(user)) return c.json({ error: 'Forbidden' }, 403)

  const id = c.req.param('id')
  const parsed = ApplicationUpdateBodySchema.safeParse(await c.req.json())
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? 'invalid body' }, 400)
  }
  const body = parsed.data

  const updates: string[] = []
  const values: unknown[] = []
  let i = 1

  if (body.name !== undefined) {
    const name = body.name.trim()
    if (!name) return c.json({ error: 'name cannot be empty' }, 400)
    updates.push(`name = $${i++}`)
    values.push(name)
  }
  if (body.description !== undefined) {
    const description =
      typeof body.description === 'string' ? body.description.trim() || null : null
    updates.push(`description = $${i++}`)
    values.push(description)
  }
  if (body.homepage_url !== undefined) {
    const homepage = sanitizeHttpUrl(body.homepage_url)
    if (!homepage.ok) {
      return c.json({ error: 'homepage_url must be an http(s) URL' }, 400)
    }
    updates.push(`homepage_url = $${i++}`)
    values.push(homepage.value)
  }
  if (body.redirect_uris !== undefined) {
    const redirectUris = sanitizeRedirectUris(body.redirect_uris)
    if (!redirectUris) {
      return c.json({ error: 'redirect_uris must be a non-empty array of http(s) URLs' }, 400)
    }
    updates.push(`redirect_uris = $${i++}`)
    values.push(redirectUris)
  }

  if (updates.length === 0) return c.json({ error: 'nothing to update' }, 400)

  updates.push('updated_at = NOW()')
  values.push(id)

  const { rowCount } = await pool.query(
    `UPDATE oauth_clients SET ${updates.join(', ')} WHERE id = $${i}`,
    values,
  )
  if (!rowCount) return c.json({ error: 'not found' }, 404)
  return c.json({ success: true })
})

// POST /api/applications/:id/rotate-secret — admin only; returns new plaintext secret
applications.post('/:id/rotate-secret', async (c) => {
  const user = c.get('user')
  if (!requireAdmin(user)) return c.json({ error: 'Forbidden' }, 403)

  const id = c.req.param('id')
  const secret = generateClientSecret()
  const secretHash = hashSecret(secret)

  const { rowCount } = await pool.query(
    'UPDATE oauth_clients SET secret_hash = $1, updated_at = NOW() WHERE id = $2',
    [secretHash, id],
  )
  if (!rowCount) return c.json({ error: 'not found' }, 404)
  return c.json({ id, client_secret: secret })
})

// DELETE /api/applications/:id — admin only
applications.delete('/:id', async (c) => {
  const user = c.get('user')
  if (!requireAdmin(user)) return c.json({ error: 'Forbidden' }, 403)

  const id = c.req.param('id')
  const { rowCount } = await pool.query('DELETE FROM oauth_clients WHERE id = $1', [id])
  if (!rowCount) return c.json({ error: 'not found' }, 404)
  return c.json({ success: true })
})

export default applications
