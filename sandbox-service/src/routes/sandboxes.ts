import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { AuthUser } from '../lib/auth'
import * as launches from '../lib/launches'
import * as sandbox from '../lib/sandbox'
import {
  CreateSandboxBodySchema,
  DeleteSandboxResponseSchema,
  EndpointResponseSchema,
  ErrorSchema,
  ExecBodySchema,
  ExecResponseSchema,
  ListFilesResponseSchema,
  ListLaunchesResponseSchema,
  ListSandboxesResponseSchema,
  ReadFileResponseSchema,
  RenewSandboxBodySchema,
  RenewSandboxResponseSchema,
  SandboxInfoSchema,
  WriteFilesBodySchema,
  WriteFilesResponseSchema,
} from '../schemas'

function basenameOf(p: string): string {
  const i = p.lastIndexOf('/')
  return i < 0 ? p : p.slice(i + 1)
}

function parseRange(header: string, totalSize: number): { start: number; end: number } | null {
  const m = header.match(/^bytes=(\d*)-(\d*)$/)
  if (!m) return null
  const startStr = m[1]
  const endStr = m[2]
  let start: number
  let end: number
  if (startStr === '' && endStr !== '') {
    const suffix = Number.parseInt(endStr, 10)
    if (!Number.isFinite(suffix) || suffix <= 0) return null
    start = Math.max(0, totalSize - suffix)
    end = totalSize - 1
  } else if (startStr !== '') {
    start = Number.parseInt(startStr, 10)
    end = endStr === '' ? totalSize - 1 : Number.parseInt(endStr, 10)
  } else {
    return null
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  if (start > end || start >= totalSize) return null
  if (end >= totalSize) end = totalSize - 1
  return { start, end }
}

function streamWithCleanup(
  iter: AsyncIterable<Uint8Array>,
  cleanup: () => Promise<void>,
): ReadableStream<Uint8Array> {
  const it = iter[Symbol.asyncIterator]()
  let cleaned = false
  const runCleanup = async () => {
    if (cleaned) return
    cleaned = true
    try {
      await cleanup()
    } catch (e) {
      console.error('[files] stream cleanup failed:', e)
    }
  }
  return new ReadableStream({
    async pull(controller) {
      try {
        const { value, done } = await it.next()
        if (done) {
          controller.close()
          await runCleanup()
        } else {
          controller.enqueue(value)
        }
      } catch (e) {
        controller.error(e)
        await runCleanup()
      }
    },
    async cancel() {
      try {
        await it.return?.()
      } catch {
        // ignore
      }
      await runCleanup()
    },
  })
}

type Env = { Variables: { user: AuthUser } }

const OWNER_KEY = 'sandbox.owner_id'

const IdParam = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' }, example: 'sbx-abc123' }),
})

const IdPortParam = IdParam.extend({
  port: z.string().openapi({ param: { name: 'port', in: 'path' }, example: '3000' }),
})

const errorResponses = {
  400: { description: 'Bad request', content: { 'application/json': { schema: ErrorSchema } } },
  404: {
    description: 'Sandbox not found',
    content: { 'application/json': { schema: ErrorSchema } },
  },
  500: { description: 'Server error', content: { 'application/json': { schema: ErrorSchema } } },
}

const tag = ['sandboxes']
const security = [{ bearerAuth: [] }]

async function withOwnership(c: any, sandboxId: string) {
  const user = c.get('user') as AuthUser
  const info = await sandbox.getSandbox(sandboxId)
  if (user.sub !== '_service' && info.metadata?.[OWNER_KEY] !== user.sub) {
    return null
  }
  return info
}

const sandboxes = new OpenAPIHono<Env>()

// Create
sandboxes.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: tag,
    security,
    summary: 'Create a sandbox',
    request: {
      body: { content: { 'application/json': { schema: CreateSandboxBodySchema } } },
    },
    responses: {
      201: {
        description: 'Created',
        content: { 'application/json': { schema: SandboxInfoSchema } },
      },
      500: errorResponses[500],
    },
  }),
  async (c) => {
    const user = c.get('user')
    const body = c.req.valid('json')
    try {
      const resource = (body.resource ?? { cpu: '500m', memory: '512Mi' }) as Record<string, string>
      const userMetadata = { ...(body.metadata ?? {}) } as Record<string, string>
      const fullMetadata = {
        ...userMetadata,
        ...(user.sub !== '_service' ? { [OWNER_KEY]: user.sub } : {}),
      }
      const info = await sandbox.createSandbox({
        image: body.image,
        resource,
        timeoutSeconds: body.timeoutSeconds,
        entrypoint: body.entrypoint,
        env: body.env,
        metadata: fullMetadata,
      })
      const launchOwnerId = user.sub === '_service' && body.ownerId ? body.ownerId : user.sub
      try {
        await launches.recordLaunch({
          sandboxId: info.id,
          ownerId: launchOwnerId,
          image: body.image,
          resource,
          entrypoint: body.entrypoint,
          metadata: userMetadata,
          expiresAt:
            info.expiresAt instanceof Date
              ? info.expiresAt.toISOString()
              : (info.expiresAt as string | null),
        })
      } catch (e) {
        console.error('[launches] recordLaunch failed:', e)
      }
      return c.json(info as any, 201)
    } catch (e: any) {
      return c.json({ error: e.message }, 500)
    }
  },
)

// List
sandboxes.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: tag,
    security,
    summary: 'List sandboxes (filtered by owner)',
    description:
      'Supports metadata filters via `metadata.<key>=<value>` query params. Always scoped to the authenticated user except for service accounts.',
    responses: {
      200: {
        description: 'OK',
        content: { 'application/json': { schema: ListSandboxesResponseSchema } },
      },
      500: errorResponses[500],
    },
  }),
  async (c) => {
    const user = c.get('user')
    try {
      const metadata: Record<string, string> = {}
      for (const [k, v] of new URL(c.req.url).searchParams) {
        if (k.startsWith('metadata.')) {
          metadata[k.slice('metadata.'.length)] = v
        }
      }
      if (user.sub !== '_service') {
        metadata[OWNER_KEY] = user.sub
      }
      const result = await sandbox.listSandboxes({ metadata })
      return c.json(result as any, 200)
    } catch (e: any) {
      return c.json({ error: e.message }, 500)
    }
  },
)

// Launch history (persists across TTL recycling, owner-scoped).
// Registered before /{id} so the literal path takes precedence.
sandboxes.openapi(
  createRoute({
    method: 'get',
    path: '/launches',
    tags: tag,
    security,
    summary: 'List launch records (persisted, includes recycled sandboxes)',
    description:
      'Returns launch history scoped to the authenticated user. Service accounts see all records. Supports `limit` (max 500) and `before` (ISO timestamp) for pagination.',
    request: {
      query: z.object({
        limit: z
          .string()
          .optional()
          .openapi({ param: { name: 'limit', in: 'query' }, example: '100' }),
        before: z
          .string()
          .optional()
          .openapi({ param: { name: 'before', in: 'query' } }),
      }),
    },
    responses: {
      200: {
        description: 'OK',
        content: { 'application/json': { schema: ListLaunchesResponseSchema } },
      },
      500: errorResponses[500],
    },
  }),
  async (c) => {
    const user = c.get('user')
    try {
      const { limit, before } = c.req.valid('query')
      const rows = await launches.listLaunches({
        ownerId: user.sub === '_service' ? undefined : user.sub,
        limit: limit ? Number.parseInt(limit, 10) : undefined,
        before,
      })
      return c.json(
        {
          launches: rows.map((r) => ({
            sandboxId: r.sandbox_id,
            ownerId: r.owner_id,
            image: r.image,
            resource: r.resource,
            entrypoint: r.entrypoint,
            metadata: r.metadata,
            createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
            expiresAt: r.expires_at instanceof Date ? r.expires_at.toISOString() : r.expires_at,
            renewCount: r.renew_count,
            lastRenewedAt:
              r.last_renewed_at instanceof Date
                ? r.last_renewed_at.toISOString()
                : r.last_renewed_at,
          })),
        },
        200,
      )
    } catch (e: any) {
      return c.json({ error: e.message }, 500)
    }
  },
)

// Get
sandboxes.openapi(
  createRoute({
    method: 'get',
    path: '/{id}',
    tags: tag,
    security,
    summary: 'Get sandbox by ID',
    request: { params: IdParam },
    responses: {
      200: {
        description: 'OK',
        content: { 'application/json': { schema: SandboxInfoSchema } },
      },
      404: errorResponses[404],
      500: errorResponses[500],
    },
  }),
  async (c) => {
    try {
      const info = await withOwnership(c, c.req.param('id'))
      if (!info) return c.json({ error: 'Sandbox not found' }, 404)
      return c.json(info as any, 200)
    } catch (e: any) {
      return c.json({ error: e.message }, 500)
    }
  },
)

// Delete
sandboxes.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}',
    tags: tag,
    security,
    summary: 'Delete a sandbox',
    request: { params: IdParam },
    responses: {
      200: {
        description: 'Deleted',
        content: { 'application/json': { schema: DeleteSandboxResponseSchema } },
      },
      404: errorResponses[404],
      500: errorResponses[500],
    },
  }),
  async (c) => {
    try {
      const info = await withOwnership(c, c.req.param('id'))
      if (!info) return c.json({ error: 'Sandbox not found' }, 404)
      await sandbox.deleteSandbox(c.req.param('id'))
      return c.json({ success: true as const }, 200)
    } catch (e: any) {
      return c.json({ error: e.message }, 500)
    }
  },
)

// Renew
sandboxes.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/renew',
    tags: tag,
    security,
    summary: 'Extend sandbox expiration',
    request: {
      params: IdParam,
      body: { content: { 'application/json': { schema: RenewSandboxBodySchema } } },
    },
    responses: {
      200: {
        description: 'Renewed',
        content: { 'application/json': { schema: RenewSandboxResponseSchema } },
      },
      404: errorResponses[404],
      500: errorResponses[500],
    },
  }),
  async (c) => {
    try {
      const info = await withOwnership(c, c.req.param('id'))
      if (!info) return c.json({ error: 'Sandbox not found' }, 404)
      const body = c.req.valid('json')
      const result = await sandbox.renewSandbox(c.req.param('id'), body.timeoutSeconds ?? 3600)
      try {
        await launches.recordRenew(c.req.param('id'), result.expiresAt)
      } catch (e) {
        console.error('[launches] recordRenew failed:', e)
      }
      return c.json(result, 200)
    } catch (e: any) {
      return c.json({ error: e.message }, 500)
    }
  },
)

// Exec
sandboxes.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/exec',
    tags: tag,
    security,
    summary: 'Run a shell command inside the sandbox',
    request: {
      params: IdParam,
      body: { content: { 'application/json': { schema: ExecBodySchema } } },
    },
    responses: {
      200: {
        description: 'Command result',
        content: { 'application/json': { schema: ExecResponseSchema } },
      },
      404: errorResponses[404],
      500: errorResponses[500],
    },
  }),
  async (c) => {
    try {
      const info = await withOwnership(c, c.req.param('id'))
      if (!info) return c.json({ error: 'Sandbox not found' }, 404)
      const body = c.req.valid('json')
      const result = await sandbox.runCommand(c.req.param('id'), body.command, {
        cwd: body.cwd,
        timeoutSeconds: body.timeoutSeconds,
        env: body.env,
      })
      return c.json(result, 200)
    } catch (e: any) {
      return c.json({ error: e.message }, 500)
    }
  },
)

// List files (directory listing)
sandboxes.openapi(
  createRoute({
    method: 'get',
    path: '/{id}/files/list',
    tags: tag,
    security,
    summary: 'List files in a sandbox directory',
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
      400: errorResponses[400],
      404: errorResponses[404],
      500: errorResponses[500],
    },
  }),
  async (c) => {
    try {
      const info = await withOwnership(c, c.req.param('id'))
      if (!info) return c.json({ error: 'Sandbox not found' }, 404)
      const { path, pattern } = c.req.valid('query')
      const files = await sandbox.listFiles(c.req.param('id'), path, pattern)
      return c.json({ files: files as any[] }, 200)
    } catch (e: any) {
      return c.json({ error: e.message }, 500)
    }
  },
)

// Stream raw file bytes (octet-stream, supports HTTP Range)
sandboxes.openapi(
  createRoute({
    method: 'get',
    path: '/{id}/files/raw',
    tags: tag,
    security,
    summary: 'Stream raw file bytes from the sandbox',
    description:
      'Returns the file as `application/octet-stream`. Honors `Range: bytes=start-end` for partial reads (responds 206 with `Content-Range`).',
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
      400: errorResponses[400],
      404: errorResponses[404],
      416: {
        description: 'Requested range not satisfiable',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      500: errorResponses[500],
    },
  }),
  async (c) => {
    const sandboxId = c.req.param('id')
    try {
      const info = await withOwnership(c, sandboxId)
      if (!info) return c.json({ error: 'Sandbox not found' }, 404)
      const { path } = c.req.valid('query')

      const stat = await sandbox.statFile(sandboxId, path)
      if (!stat) return c.json({ error: 'File not found' }, 404)
      const total = stat.size ?? 0

      const rangeHeader = c.req.header('range')
      let range: { start: number; end: number } | null = null
      if (rangeHeader) {
        range = parseRange(rangeHeader, total)
        if (!range) {
          return c.body(null, 416, {
            'Content-Range': `bytes */${total}`,
          }) as any
        }
      }

      const sdkRange = range ? `bytes=${range.start}-${range.end}` : undefined
      const { stream, close } = await sandbox.readFileStream(sandboxId, path, sdkRange)
      const body = streamWithCleanup(stream, close)

      const filename = basenameOf(path)
      const headers: Record<string, string> = {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${filename.replace(/"/g, '')}"`,
        'Accept-Ranges': 'bytes',
      }
      if (range) {
        headers['Content-Length'] = String(range.end - range.start + 1)
        headers['Content-Range'] = `bytes ${range.start}-${range.end}/${total}`
        return new Response(body, { status: 206, headers })
      }
      headers['Content-Length'] = String(total)
      return new Response(body, { status: 200, headers })
    } catch (e: any) {
      return c.json({ error: e.message }, 500)
    }
  },
)

// Read file
sandboxes.openapi(
  createRoute({
    method: 'get',
    path: '/{id}/files',
    tags: tag,
    security,
    summary: 'Read a file from the sandbox',
    request: {
      params: IdParam,
      query: z.object({
        path: z.string().openapi({ param: { name: 'path', in: 'query' }, example: '/tmp/foo.txt' }),
      }),
    },
    responses: {
      200: {
        description: 'File content',
        content: { 'application/json': { schema: ReadFileResponseSchema } },
      },
      400: errorResponses[400],
      404: errorResponses[404],
      500: errorResponses[500],
    },
  }),
  async (c) => {
    try {
      const info = await withOwnership(c, c.req.param('id'))
      if (!info) return c.json({ error: 'Sandbox not found' }, 404)
      const { path } = c.req.valid('query')
      const content = await sandbox.readFile(c.req.param('id'), path)
      return c.json({ content }, 200)
    } catch (e: any) {
      return c.json({ error: e.message }, 500)
    }
  },
)

// Write files
sandboxes.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/files',
    tags: tag,
    security,
    summary: 'Write one or more files to the sandbox',
    request: {
      params: IdParam,
      body: { content: { 'application/json': { schema: WriteFilesBodySchema } } },
    },
    responses: {
      200: {
        description: 'Written',
        content: { 'application/json': { schema: WriteFilesResponseSchema } },
      },
      404: errorResponses[404],
      500: errorResponses[500],
    },
  }),
  async (c) => {
    try {
      const info = await withOwnership(c, c.req.param('id'))
      if (!info) return c.json({ error: 'Sandbox not found' }, 404)
      const body = c.req.valid('json')
      await sandbox.writeFiles(
        c.req.param('id'),
        body.files.map((f) => ({ path: f.path, data: f.content })),
      )
      return c.json({ success: true as const, count: body.files.length }, 200)
    } catch (e: any) {
      return c.json({ error: e.message }, 500)
    }
  },
)

// Endpoint URL for a port
sandboxes.openapi(
  createRoute({
    method: 'get',
    path: '/{id}/endpoint/{port}',
    tags: tag,
    security,
    summary: 'Get preview endpoint URL for a port exposed by the sandbox',
    request: { params: IdPortParam },
    responses: {
      200: {
        description: 'Endpoint URL',
        content: { 'application/json': { schema: EndpointResponseSchema } },
      },
      400: errorResponses[400],
      404: errorResponses[404],
      500: errorResponses[500],
    },
  }),
  async (c) => {
    try {
      const info = await withOwnership(c, c.req.param('id'))
      if (!info) return c.json({ error: 'Sandbox not found' }, 404)
      const port = Number.parseInt(c.req.param('port'), 10)
      if (!Number.isFinite(port) || port < 1 || port > 65535) {
        return c.json({ error: 'Invalid port' }, 400)
      }
      const url = await sandbox.getEndpoint(c.req.param('id'), port)
      return c.json({ url }, 200)
    } catch (e: any) {
      return c.json({ error: e.message }, 500)
    }
  },
)

export default sandboxes
