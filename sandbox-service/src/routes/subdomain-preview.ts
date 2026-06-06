// Subdomain-based preview: {sandboxId}-{port}.<SANDBOX_DOMAIN>
// Routes requests to the sandbox's internal port, with the app running at root /.

import type { Context } from 'hono'
import * as sandbox from '../lib/sandbox'

/**
 * Parse subdomain like "7c492cb2-4d57-44c2-ba49-8da1f17898bf-3000"
 * into { sandboxId, port }.
 * Format: {sandboxId}-{port} where sandboxId is a UUID (contains hyphens).
 * We split from the right: last segment after the final hyphen is the port.
 */
export function parseSubdomain(
  host: string,
  baseDomain: string,
): { sandboxId: string; port: number } | null {
  const sub = host.replace(`.${baseDomain}`, '')
  const lastDash = sub.lastIndexOf('-')
  if (lastDash < 1) return null

  const portStr = sub.slice(lastDash + 1)
  const port = Number.parseInt(portStr, 10)
  if (!Number.isFinite(port) || port < 1 || port > 65535) return null

  const sandboxId = sub.slice(0, lastDash)
  if (!sandboxId) return null

  return { sandboxId, port }
}

export async function handleSubdomainPreview(
  c: Context,
  host: string,
  baseDomain: string,
): Promise<Response> {
  const parsed = parseSubdomain(host, baseDomain)
  if (!parsed) {
    return c.json({ error: 'Invalid preview subdomain' }, 400)
  }

  const { sandboxId, port } = parsed

  // No auth for subdomain preview — sandbox ID (UUID) serves as the access token.
  // This matches Vercel Sandbox behavior: preview URLs are public.

  // Resolve internal endpoint
  let endpointUrl: string
  try {
    endpointUrl = await sandbox.getEndpoint(sandboxId, port)
  } catch {
    return c.json({ error: 'Endpoint not available' }, 502)
  }

  // WebSocket upgrades for subdomain preview are handled at the raw HTTP
  // server layer in src/index.ts (httpServer.on('upgrade', ...)). This
  // function only sees plain HTTP requests.

  // HTTP proxy — app runs at root, so pass path through directly
  const url = new URL(c.req.url)
  const subpath = (url.pathname || '/') + url.search
  const targetUrl = `${endpointUrl.replace(/\/$/, '')}${subpath}`

  try {
    const reqHeaders = new Headers(c.req.raw.headers)
    reqHeaders.delete('host')

    const proxyRes = await fetch(targetUrl, {
      method: c.req.method,
      headers: reqHeaders,
      body: c.req.method !== 'GET' && c.req.method !== 'HEAD' ? c.req.raw.body : undefined,
      redirect: 'manual',
    })

    const resHeaders = new Headers(proxyRes.headers)
    resHeaders.delete('transfer-encoding')

    return new Response(proxyRes.body, {
      status: proxyRes.status,
      headers: resHeaders,
    })
  } catch (err) {
    console.error(`[subdomain-preview] error for ${sandboxId}:${port}:`, err)
    return c.json({ error: 'Proxy failed' }, 502)
  }
}
