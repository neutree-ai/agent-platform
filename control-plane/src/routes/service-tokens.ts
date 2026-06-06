import { Hono } from 'hono'
import { generateToken, hashToken } from '../lib/service-token'
import type { AppEnv } from '../lib/types'
import { createServiceToken, listServiceTokens, revokeServiceToken } from '../services/db/shares'

const serviceTokenRoutes = new Hono<AppEnv>()

// POST /api/service-tokens — create a service token
serviceTokenRoutes.post('/', async (c) => {
  const currentUser = c.get('user')
  const body = await c.req.json<{ name: string }>()

  if (!body.name) {
    return c.json({ error: 'name is required' }, 400)
  }

  const token = generateToken()
  const record = await createServiceToken(body.name, hashToken(token), currentUser.sub)

  // Return plaintext token only once
  return c.json({ id: record.id, name: body.name, token, created_at: record.created_at }, 201)
})

// GET /api/service-tokens — list current user's tokens (no secrets)
serviceTokenRoutes.get('/', async (c) => {
  const currentUser = c.get('user')
  const tokens = await listServiceTokens(currentUser.sub)
  return c.json(tokens)
})

// DELETE /api/service-tokens/:id — revoke a token (own tokens only)
serviceTokenRoutes.delete('/:id', async (c) => {
  const currentUser = c.get('user')
  const id = c.req.param('id')
  const tokens = await listServiceTokens(currentUser.sub)
  if (!tokens.some((t) => t.id === id)) {
    return c.json({ error: 'Token not found or not owned by you' }, 404)
  }
  const revoked = await revokeServiceToken(id)
  if (!revoked) {
    return c.json({ error: 'Token not found or already revoked' }, 404)
  }
  return c.json({ success: true })
})

export default serviceTokenRoutes
