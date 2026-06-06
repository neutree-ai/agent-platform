import { Hono } from 'hono'
import type { AppEnv } from '../lib/types'
import * as db from '../services/db'

const app = new Hono<AppEnv>()

// List events (optionally filter by route_id or connector_id)
app.get('/', async (c) => {
  const userId = c.get('user').sub
  const route_id = c.req.query('route_id')
  const connector_id = c.req.query('connector_id')
  const limit = Number(c.req.query('limit')) || 50
  const offset = Number(c.req.query('offset')) || 0

  const result = await db.listEvents({ user_id: userId, route_id, connector_id, limit, offset })
  return c.json(result)
})

export default app
