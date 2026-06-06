import { Hono } from 'hono'

const CG_DEFAULT = 'http://nap-cg:3002'

function getCgBaseUrl(): string {
  return (process.env.CG_URL || CG_DEFAULT).replace(/\/$/, '')
}

const cgProxy = new Hono()

cgProxy.all('/*', async (c) => {
  const baseUrl = getCgBaseUrl()

  // /_cg/connectors → /api/connectors
  const subPath = c.req.path.replace(/^\/_cg\/?/, '')
  const url = new URL(c.req.url)
  const targetUrl = `${baseUrl}/api/${subPath}${url.search}`

  const headers = new Headers()
  const contentType = c.req.header('Content-Type')
  if (contentType) headers.set('Content-Type', contentType)
  const cookie = c.req.header('Cookie')
  if (cookie) headers.set('Cookie', cookie)

  let body: ArrayBuffer | undefined
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    body = await c.req.arrayBuffer()
  }

  const resp = await fetch(targetUrl, {
    method: c.req.method,
    headers,
    body,
  })

  return new Response(resp.body, {
    status: resp.status,
    headers: { 'Content-Type': resp.headers.get('Content-Type') || 'application/json' },
  })
})

export default cgProxy
