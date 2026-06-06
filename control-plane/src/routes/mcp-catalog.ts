import { Hono } from 'hono'
import { listMcpCatalog } from '../services/db/mcp-catalog'

const mcpCatalog = new Hono()

mcpCatalog.get('/', async (c) => {
  const entries = await listMcpCatalog()
  return c.json(entries)
})

export default mcpCatalog
