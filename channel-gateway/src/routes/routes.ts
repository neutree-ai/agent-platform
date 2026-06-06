import { Hono } from 'hono'
import type { AppEnv } from '../lib/types'
import * as db from '../services/db'

const app = new Hono<AppEnv>()

// List routes (optionally filter by connector_id)
app.get('/', async (c) => {
  const userId = c.get('user').sub
  const connector_id = c.req.query('connector_id')
  const routes = await db.listRoutes(userId, connector_id)
  return c.json(routes)
})

// Create route
app.post('/', async (c) => {
  const userId = c.get('user').sub
  const body = await c.req.json()
  const { connector_id, external_id, workspace_id, name, config } = body

  if (!connector_id || !external_id || !workspace_id) {
    return c.json({ error: 'connector_id, external_id, and workspace_id are required' }, 400)
  }

  // Verify connector belongs to user
  const connector = await db.getConnector(connector_id, userId)
  if (!connector) {
    return c.json({ error: 'connector not found' }, 404)
  }

  const route = await db.createRoute({ user_id: userId, connector_id, external_id, workspace_id, name, config })
  return c.json(route, 201)
})

// Get route
app.get('/:id', async (c) => {
  const userId = c.get('user').sub
  const route = await db.getRoute(c.req.param('id'), userId)
  if (!route) return c.json({ error: 'not found' }, 404)
  return c.json(route)
})

// Get route secret
app.get('/:id/secret', async (c) => {
  const userId = c.get('user').sub
  const route = await db.getRoute(c.req.param('id'), userId)
  if (!route) return c.json({ error: 'not found' }, 404)
  const config = route.config as Record<string, unknown> | undefined
  return c.json({ secret: (config?.secret as string) ?? '' })
})

// Update route
app.patch('/:id', async (c) => {
  const userId = c.get('user').sub
  const body = await c.req.json()
  const route = await db.updateRoute(c.req.param('id'), userId, body)
  if (!route) return c.json({ error: 'not found' }, 404)
  return c.json(route)
})

// Delete route
app.delete('/:id', async (c) => {
  const userId = c.get('user').sub
  const deleted = await db.deleteRoute(c.req.param('id'), userId)
  if (!deleted) return c.json({ error: 'not found' }, 404)
  return c.json({ ok: true })
})

export default app
