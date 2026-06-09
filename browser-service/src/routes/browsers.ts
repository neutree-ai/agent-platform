import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { SessionPayload } from '../lib/session'
import {
  BrowserListResponseSchema,
  BrowserSchema,
  CreateBrowserBodySchema,
  DeleteBrowserResponseSchema,
  ErrorSchema,
  ListFilesResponseSchema,
  RenewBrowserBodySchema,
  RenewBrowserResponseSchema,
} from '../schemas'
import * as pool from '../services/pool'
import * as sandbox from '../services/sandbox'

const BROWSER_SERVICE_URL = process.env.BROWSER_SERVICE_URL || 'http://localhost:3005'

type Env = { Variables: { user: SessionPayload } }

function publicEndpoints(id: string) {
  return {
    cdp: `${BROWSER_SERVICE_URL}/cdp/${id}`,
    live_view: `${BROWSER_SERVICE_URL}/live/${id}/`,
  }
}

const IdParam = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' }, example: 'brw-abc123' }),
})

const errorResponses = {
  404: {
    description: 'Not found',
    content: { 'application/json': { schema: ErrorSchema } },
  },
}

const tag = ['browsers']
const security = [{ bearerAuth: [] }]

const browsers = new OpenAPIHono<Env>()

// Create
browsers.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: tag,
    security,
    summary: 'Create a browser instance',
    request: {
      body: {
        content: { 'application/json': { schema: CreateBrowserBodySchema } },
      },
    },
    responses: {
      201: {
        description: 'Created',
        content: { 'application/json': { schema: BrowserSchema } },
      },
    },
  }),
  async (c) => {
    const user = c.get('user')
    const body = c.req.valid('json')
    const timeoutSeconds = Math.max(60, Math.min(86400, body.timeout_seconds ?? 3600))

    // Try the warm pool first. Only a custom `resource` bypasses it (that
    // changes the instance build); `metadata` is just tags we record on the
    // claim and merge virtually, so it's pool-compatible.
    const canUsePool = pool.isPoolEnabled() && !body.resource
    let sbx = canUsePool ? await pool.claim(user.sub, timeoutSeconds, body.metadata) : null
    if (!sbx) {
      sbx = await sandbox.createBrowser(user.sub, {
        timeoutSeconds,
        resource: body.resource,
        metadata: body.metadata,
      })
    }

    return c.json(
      {
        id: sbx.id,
        status: sbx.status.state,
        expires_at: sbx.expiresAt,
        created_at: sbx.createdAt,
        endpoints: publicEndpoints(sbx.id),
      },
      201,
    )
  },
)

// List
browsers.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: tag,
    security,
    summary: 'List my browsers',
    description:
      'Supports metadata filters via `metadata.<key>=<value>` query params. Always scoped to the authenticated user.',
    responses: {
      200: {
        description: 'OK',
        content: { 'application/json': { schema: BrowserListResponseSchema } },
      },
    },
  }),
  async (c) => {
    const user = c.get('user')
    const url = new URL(c.req.url)
    const metadata: Record<string, string> = {}
    for (const [k, v] of url.searchParams) {
      if (k.startsWith('metadata.')) {
        metadata[k.slice('metadata.'.length)] = v
      }
    }
    const metadataFilter = Object.keys(metadata).length > 0 ? metadata : undefined
    const result = await sandbox.listBrowsers(user.sub, metadataFilter)

    // Claimed pool instances carry no browser.user_id metadata, so the
    // server-side filter above never returns them — add them from the claim map.
    const known = new Set(result.items.map((s) => s.id))
    for (const { id, metadata: claimMeta } of pool.ownedClaims(user.sub)) {
      if (known.has(id)) continue
      // Only a provable 404 releases the claim; a transient error keeps it so a
      // routine list poll can never orphan a live browser.
      let s: Awaited<ReturnType<typeof sandbox.getBrowserOrNull>>
      try {
        s = await sandbox.getBrowserOrNull(id)
      } catch {
        continue
      }
      if (s === null) {
        pool.releaseClaim(id)
        continue
      }
      // Pooled instances can't carry the caller's tags in sandbox metadata;
      // merge the claim-time metadata so workspace-scoped filters still match.
      const merged = { ...s.metadata, ...claimMeta }
      if (metadataFilter && !Object.entries(metadataFilter).every(([k, v]) => merged[k] === v)) {
        continue
      }
      result.items.push(s)
    }

    return c.json(
      {
        items: result.items.map((s) => ({
          id: s.id,
          status: s.status.state,
          expires_at: s.expiresAt,
          created_at: s.createdAt,
        })),
      },
      200,
    )
  },
)

// Get detail
browsers.openapi(
  createRoute({
    method: 'get',
    path: '/{id}',
    tags: tag,
    security,
    summary: 'Get browser detail',
    request: { params: IdParam },
    responses: {
      200: {
        description: 'OK',
        content: { 'application/json': { schema: BrowserSchema } },
      },
      404: errorResponses[404],
    },
  }),
  async (c) => {
    const user = c.get('user')
    const sbx = await sandbox.getBrowser(c.req.param('id'))

    if (!pool.isOwnedBy(sbx, user.sub)) {
      return c.json({ error: 'Not found' }, 404)
    }

    return c.json(
      {
        id: sbx.id,
        status: sbx.status.state,
        expires_at: sbx.expiresAt,
        created_at: sbx.createdAt,
        endpoints: publicEndpoints(sbx.id),
      },
      200,
    )
  },
)

// Renew
browsers.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/renew',
    tags: tag,
    security,
    summary: 'Renew browser expiration',
    request: {
      params: IdParam,
      body: {
        content: { 'application/json': { schema: RenewBrowserBodySchema } },
      },
    },
    responses: {
      200: {
        description: 'Renewed',
        content: { 'application/json': { schema: RenewBrowserResponseSchema } },
      },
      404: errorResponses[404],
    },
  }),
  async (c) => {
    const user = c.get('user')
    const sbx = await sandbox.getBrowser(c.req.param('id'))

    if (!pool.isOwnedBy(sbx, user.sub)) {
      return c.json({ error: 'Not found' }, 404)
    }

    const body = c.req.valid('json')
    const result = await sandbox.renewBrowser(sbx.id, body.timeout_seconds ?? 3600)
    return c.json({ expires_at: result.expiresAt }, 200)
  },
)

// Delete
browsers.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}',
    tags: tag,
    security,
    summary: 'Delete a browser',
    description:
      'Idempotent. Silently succeeds if the browser no longer exists, as long as the original (if any) belonged to the caller.',
    request: { params: IdParam },
    responses: {
      200: {
        description: 'Deleted',
        content: { 'application/json': { schema: DeleteBrowserResponseSchema } },
      },
      404: errorResponses[404],
    },
  }),
  async (c) => {
    const user = c.get('user')

    try {
      const sbx = await sandbox.getBrowser(c.req.param('id'))
      if (!pool.isOwnedBy(sbx, user.sub)) {
        return c.json({ error: 'Not found' }, 404)
      }
    } catch {
      // already gone
    }

    try {
      await sandbox.deleteBrowser(c.req.param('id'))
    } catch {
      // already gone
    }
    pool.releaseClaim(c.req.param('id'))

    return c.json({ success: true as const }, 200)
  },
)

// List files in the browser sandbox
browsers.openapi(
  createRoute({
    method: 'get',
    path: '/{id}/files',
    tags: tag,
    security,
    summary: 'List files in the browser sandbox',
    description:
      'Lists files in a directory inside the browser sandbox. Useful for inspecting the download directory configured by the agent via CDP `Browser.setDownloadBehavior`.',
    request: {
      params: IdParam,
      query: z.object({
        path: z.string().openapi({ param: { name: 'path', in: 'query' }, example: '/downloads' }),
        pattern: z
          .string()
          .optional()
          .openapi({ param: { name: 'pattern', in: 'query' } }),
      }),
    },
    responses: {
      200: {
        description: 'OK',
        content: { 'application/json': { schema: ListFilesResponseSchema } },
      },
      404: errorResponses[404],
    },
  }),
  async (c) => {
    const user = c.get('user')
    const sbx = await sandbox.getBrowser(c.req.param('id'))
    if (!pool.isOwnedBy(sbx, user.sub)) {
      return c.json({ error: 'Not found' }, 404)
    }
    const { path, pattern } = c.req.valid('query')
    const files = await sandbox.listFiles(c.req.param('id'), path, pattern)
    return c.json({ files }, 200)
  },
)

// Stream raw file bytes (octet-stream, supports HTTP Range)
browsers.openapi(
  createRoute({
    method: 'get',
    path: '/{id}/files/content',
    tags: tag,
    security,
    summary: 'Download a file from the browser sandbox',
    description:
      'Streams the file as `application/octet-stream`. Honors `Range: bytes=start-end` for partial reads.',
    request: {
      params: IdParam,
      query: z.object({
        path: z
          .string()
          .openapi({ param: { name: 'path', in: 'query' }, example: '/downloads/foo.pdf' }),
      }),
    },
    responses: {
      200: {
        description: 'Full file content',
        content: {
          'application/octet-stream': {
            schema: z.string().openapi({ format: 'binary' }),
          },
        },
      },
      206: {
        description: 'Partial content',
        content: {
          'application/octet-stream': {
            schema: z.string().openapi({ format: 'binary' }),
          },
        },
      },
      404: errorResponses[404],
    },
  }),
  async (c) => {
    const user = c.get('user')
    const sbx = await sandbox.getBrowser(c.req.param('id'))
    if (!pool.isOwnedBy(sbx, user.sub)) {
      return c.json({ error: 'Not found' }, 404)
    }
    const { path } = c.req.valid('query')
    const range = c.req.header('range')
    const upstream = await sandbox.fetchFileRaw(c.req.param('id'), path, range)

    // Forward status + body. Pass through Content-Length / Content-Range /
    // Content-Disposition / Accept-Ranges from sandbox-service.
    const passthroughHeaders = [
      'content-type',
      'content-length',
      'content-range',
      'content-disposition',
      'accept-ranges',
    ] as const
    const forwarded: Record<string, string> = {}
    for (const h of passthroughHeaders) {
      const v = upstream.headers.get(h)
      if (v) forwarded[h] = v
    }
    if (!forwarded['content-type']) forwarded['content-type'] = 'application/octet-stream'

    return new Response(upstream.body, { status: upstream.status, headers: forwarded })
  },
)

export default browsers
