import { Hono } from 'hono'
import { httpProxy } from '../lib/proxy'
import { verifyServiceToken } from '../lib/token'
import * as pool from '../services/pool'
import * as sandbox from '../services/sandbox'

const rec = new Hono()

async function authenticate(c: any): Promise<{ sub: string } | null> {
  const authHeader = c.req.header('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    return verifyServiceToken(authHeader.slice(7))
  }
  return null
}

async function getEndpointWithAuth(c: any, port: number) {
  const user = await authenticate(c)
  if (!user) return { error: 'Unauthorized', status: 401 }

  const sandboxId = c.req.param('id')
  let sbx: Awaited<ReturnType<typeof sandbox.getBrowser>>
  try {
    sbx = await sandbox.getBrowser(sandboxId)
  } catch {
    return { error: 'Browser not found', status: 404 }
  }

  if (!pool.isOwnedBy(sbx, user.sub)) {
    return { error: 'Not found', status: 404 }
  }

  try {
    const ep = await sandbox.getEndpoint(sandboxId, port)
    return { endpoint: ep.endpoint }
  } catch {
    return { error: 'Endpoint not available', status: 502 }
  }
}

rec.all('/:id/*', async (c) => {
  const result = await getEndpointWithAuth(c, 10001)
  if ('error' in result) return c.json({ error: result.error }, result.status as any)
  return httpProxy(c, result.endpoint, '/rec')
})

rec.all('/:id', async (c) => {
  const result = await getEndpointWithAuth(c, 10001)
  if ('error' in result) return c.json({ error: result.error }, result.status as any)
  return httpProxy(c, result.endpoint, '/rec')
})

export default rec
