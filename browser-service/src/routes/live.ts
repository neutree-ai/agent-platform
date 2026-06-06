import { Hono } from 'hono'
import { getUser, httpProxy, resolveEndpoint } from '../lib/proxy'

const live = new Hono()

// Authenticated path: /live/t/:token/:id/* — token is embedded in the URL,
// so all neko sub-requests (assets, WebSocket) automatically carry it.
live.get('/t/:token/:id', (c) =>
  c.redirect(`/live/t/${c.req.param('token')}/${c.req.param('id')}/`, 302),
)

live.all('/t/:token/:id/*', async (c) => {
  // Inject token as query param so getUser() can verify it
  const url = new URL(c.req.url)
  if (!url.searchParams.has('token')) {
    url.searchParams.set('token', c.req.param('token'))
    Object.defineProperty(c.req.raw, 'url', { value: url.toString() })
  }

  const user = await getUser(c)
  if (!user) return c.json({ error: 'Unauthorized' }, 401)

  // WebSocket upgrades for this path are intercepted at the raw HTTP server
  // layer in src/index.ts; this handler only sees plain HTTP.
  const result = await resolveEndpoint(c, user, 8080)
  if (result instanceof Response) return result
  return httpProxy(c, result.endpoint, `/live/t/${c.req.param('token')}`)
})

// Legacy path: /live/:id/* — cookie/Bearer auth (BaaS standalone UI)
live.get('/:id', (c) => c.redirect(`/live/${c.req.param('id')}/`, 302))

live.all('/:id/*', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'Unauthorized' }, 401)

  const result = await resolveEndpoint(c, user, 8080)
  if (result instanceof Response) return result
  return httpProxy(c, result.endpoint, '/live')
})

export default live
