import type { createNodeWebSocket } from '@hono/node-ws'
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  AgentDirListingSchema,
  AgentMkdirBodySchema,
  AgentMoveBodySchema,
} from '../../../../internal/types/api'
import type { AppEnv } from '../../lib/types'
import { getWorkspaceAddress } from '../../lib/workspace-address'
import {
  createExportToken,
  deleteExportToken,
  listExportTokens,
} from '../../services/db/export-tokens'
import type { Workspace } from '../../services/db/types'
import { getWorkspace } from '../../services/db/workspaces'
import { canManage } from './_shared'

type UpgradeWebSocket = ReturnType<typeof createNodeWebSocket>['upgradeWebSocket']

/**
 * Agent passthrough routes mounted at /api/workspaces/:id/agent/*.
 *
 * Files / dirs / move / mkdir are REST wrappers over dufs's WebDAV
 * (CP translates MKCOL/MOVE internally so external callers never see
 * those verbs). A mirrored set (`/agent/afs-files`, `/agent/afs-dirs`,
 * `/agent/afs-move`) targets the second dufs on the agent pod that
 * serves AgentFS shared mounts at /mnt/afs. Terminal is a raw WebSocket
 * passthrough — WS isn't expressible in OpenAPI, so it's a plain Hono
 * route that sits on the same OpenAPIHono instance without being
 * registered in the doc.
 *
 * Strict ACL everywhere: no service-token bypass. Callers use the
 * owner's user token (UI) or a service token whose creator owns the
 * workspace.
 */
export function createAgentRoutes(deps: { upgradeWebSocket: UpgradeWebSocket }) {
  const { upgradeWebSocket } = deps
  const agent = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(
          { error: 'Invalid request', details: result.error.issues ?? result.error },
          400,
        )
      }
    },
  })

  const ErrorSchema = z.object({ error: z.string() })
  const SuccessSchema = z.object({ success: z.boolean() })
  const BinarySchema = z.unknown().openapi({ type: 'string', format: 'binary' })

  const PREVIEW_EXTS = new Set(['pptx', 'ppt', 'docx', 'doc', 'xlsx', 'xls', 'pdf'])

  const WorkspaceIdParam = z.object({
    id: z.string().openapi({ param: { name: 'id', in: 'path' } }),
  })
  const PathQuery = z.object({
    path: z.string().openapi({
      param: { name: 'path', in: 'query' },
      description: 'Path inside the workspace filesystem. May contain slashes.',
    }),
  })
  const DirListQuery = PathQuery.extend({
    q: z
      .string()
      .optional()
      .openapi({
        param: { name: 'q', in: 'query' },
        description: 'Optional substring search within the directory.',
      }),
  })

  async function resolveWorkspace(
    id: string,
    user: { sub: string; role: string },
  ): Promise<{ workspace: Workspace; address: string } | { error: 'not-found' | 'not-running' }> {
    const workspace = await getWorkspace(id)
    if (!workspace || !canManage(workspace, user)) return { error: 'not-found' }
    if (workspace.status !== 'running') return { error: 'not-running' }
    return { workspace, address: getWorkspaceAddress(workspace.id) }
  }

  /**
   * Tagged result — `instanceof Response` is unreliable here because Hono's
   * global Response and Node fetch's Response can come from different module
   * instances, so identity-based narrowing (`resp instanceof Response`)
   * silently fails and collapses the success branch.
   */
  type ProxyResult = { ok: true; response: Response } | { ok: false; error: string }

  async function proxyFetch(
    method: string,
    url: string,
    opts: { body?: BodyInit; headers?: Record<string, string>; signal?: AbortSignal } = {},
  ): Promise<ProxyResult> {
    try {
      const isStream = typeof ReadableStream !== 'undefined' && opts.body instanceof ReadableStream
      const response = await fetch(url, {
        method,
        headers: opts.headers,
        body: opts.body,
        signal: opts.signal,
        // @ts-expect-error -- Node.js fetch requires duplex when sending a streaming body
        duplex: isStream ? 'half' : undefined,
      })
      return { ok: true, response }
    } catch (e: any) {
      if (opts.signal?.aborted) return { ok: false, error: 'Client disconnected' }
      console.error(`[agent-files] Fetch failed ${method} ${url}:`, e.message)
      return { ok: false, error: 'Agent unavailable' }
    }
  }

  /**
   * Register a set of file/dir/move routes mirrored against one dufs instance
   * on the agent pod.
   *
   * `routeNoun` is the URL segment under /agent/ (e.g. `files` or `afs-files`);
   * `dirsNoun` / `moveNoun` follow the same convention. `dufsPrefix` is the
   * path-prefix the agent server uses to forward to its dufs instance
   * (`/files` → localhost:8000 workspace, `/afs-files` → localhost:8001 afs).
   */
  function registerFileRoutes(opts: {
    tag: string
    fsDescription: string
    routeNoun: string // e.g. 'files' or 'afs-files'
    dirsNoun: string // e.g. 'dirs' or 'afs-dirs'
    moveNoun: string // e.g. 'move' or 'afs-move'
    dufsPrefix: string // e.g. '/files' or '/afs-files'
  }) {
    const { tag, fsDescription, routeNoun, dirsNoun, moveNoun, dufsPrefix } = opts

    function buildDufsUrl(address: string, path: string, search = ''): string {
      const trimmed = path.replace(/^\//, '')
      const encoded = trimmed
        .split('/')
        .map((seg) => encodeURIComponent(seg))
        .join('/')
      const trailingSlash = path.endsWith('/') && !encoded.endsWith('/') ? '/' : ''
      return `${address}${dufsPrefix}/${encoded}${trailingSlash}${search}`
    }

    // ── GET /{id}/agent/<routeNoun>?path=... — read file (binary) ────────
    const readFileRoute = createRoute({
      method: 'get',
      path: `/{id}/agent/${routeNoun}`,
      tags: [tag],
      summary: `Read a file from the ${fsDescription}`,
      security: [{ bearerAuth: [] }],
      request: { params: WorkspaceIdParam, query: PathQuery },
      responses: {
        200: {
          description: 'File contents',
          content: { 'application/octet-stream': { schema: BinarySchema } },
        },
        404: {
          description: 'Workspace or file not found',
          content: { 'application/json': { schema: ErrorSchema } },
        },
        502: {
          description: 'Agent unavailable',
          content: { 'application/json': { schema: ErrorSchema } },
        },
        503: {
          description: 'Workspace not running',
          content: { 'application/json': { schema: ErrorSchema } },
        },
      },
    })
    agent.openapi(readFileRoute, async (c) => {
      const { id } = c.req.valid('param')
      const resolved = await resolveWorkspace(id, c.get('user'))
      if ('error' in resolved) {
        if (resolved.error === 'not-found') return c.json({ error: 'Workspace not found' }, 404)
        return c.json({ error: 'Workspace not running' }, 503)
      }
      const { path } = c.req.valid('query')
      const result = await proxyFetch('GET', buildDufsUrl(resolved.address, path), {
        signal: c.req.raw.signal,
      })
      if (!result.ok) return c.json({ error: result.error }, 502)
      const { response } = result
      const headers: Record<string, string> = {
        'Content-Type': response.headers.get('Content-Type') || 'application/octet-stream',
      }
      const cl = response.headers.get('Content-Length')
      if (cl) headers['Content-Length'] = cl
      const cd = response.headers.get('Content-Disposition')
      if (cd) headers['Content-Disposition'] = cd
      return new Response(response.body, { status: response.status, headers })
    })

    // ── GET /{id}/agent/<routeNoun>/preview?path=... — Office → PDF ──────
    //
    // Streams the original file to an external gotenberg (LibreOffice) service
    // and returns the rendered PDF. Enabled only when OFFICE_CONVERTER_URL is
    // set; otherwise returns 501 so callers can degrade gracefully.
    const previewFileRoute = createRoute({
      method: 'get',
      path: `/{id}/agent/${routeNoun}/preview`,
      tags: [tag],
      summary: 'Render an Office document (pptx/docx/xlsx/…) to PDF',
      security: [{ bearerAuth: [] }],
      request: { params: WorkspaceIdParam, query: PathQuery },
      responses: {
        200: {
          description: 'Rendered PDF',
          content: { 'application/pdf': { schema: BinarySchema } },
        },
        404: {
          description: 'Workspace or file not found',
          content: { 'application/json': { schema: ErrorSchema } },
        },
        415: {
          description: 'File type not supported for preview',
          content: { 'application/json': { schema: ErrorSchema } },
        },
        501: {
          description: 'Office converter not configured',
          content: { 'application/json': { schema: ErrorSchema } },
        },
        502: {
          description: 'Agent or converter unavailable',
          content: { 'application/json': { schema: ErrorSchema } },
        },
        503: {
          description: 'Workspace not running',
          content: { 'application/json': { schema: ErrorSchema } },
        },
      },
    })
    agent.openapi(previewFileRoute, async (c) => {
      const { id } = c.req.valid('param')
      const resolved = await resolveWorkspace(id, c.get('user'))
      if ('error' in resolved) {
        if (resolved.error === 'not-found') return c.json({ error: 'Workspace not found' }, 404)
        return c.json({ error: 'Workspace not running' }, 503)
      }
      const { path } = c.req.valid('query')
      const ext = path.split('.').pop()?.toLowerCase() ?? ''
      if (!PREVIEW_EXTS.has(ext)) {
        return c.json({ error: `File type '.${ext}' not supported for preview` }, 415)
      }

      // PDFs are already PDFs — skip the converter and stream straight through
      // so the browser can render natively. Office formats still need Gotenberg.
      const converterUrl = process.env.OFFICE_CONVERTER_URL
      if (ext !== 'pdf' && !converterUrl) {
        return c.json({ error: 'Office preview not configured' }, 501)
      }

      const fetched = await proxyFetch('GET', buildDufsUrl(resolved.address, path), {
        signal: c.req.raw.signal,
      })
      if (!fetched.ok) return c.json({ error: fetched.error }, 502)
      if (fetched.response.status === 404) return c.json({ error: 'File not found' }, 404)
      if (!fetched.response.ok) {
        return c.json({ error: `Agent returned ${fetched.response.status}` }, 502)
      }

      if (ext === 'pdf') {
        return new Response(fetched.response.body, {
          status: 200,
          headers: {
            'Content-Type': 'application/pdf',
            'Cache-Control': 'private, max-age=300',
          },
        })
      }

      const fileBuf = await fetched.response.arrayBuffer()
      const filename = path.split('/').pop() || 'file'
      const form = new FormData()
      form.append('files', new Blob([fileBuf]), filename)

      const converted = await proxyFetch(
        'POST',
        `${converterUrl!.replace(/\/$/, '')}/forms/libreoffice/convert`,
        { body: form as unknown as BodyInit, signal: c.req.raw.signal },
      )
      if (!converted.ok) return c.json({ error: converted.error }, 502)
      if (!converted.response.ok) {
        const text = await converted.response.text().catch(() => '')
        console.error(`[office-preview] converter returned ${converted.response.status}: ${text}`)
        return c.json({ error: `Converter returned ${converted.response.status}` }, 502)
      }

      return new Response(converted.response.body, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Cache-Control': 'private, max-age=300',
        },
      })
    })

    // ── PUT /{id}/agent/<routeNoun>?path=... — write file (binary) ───────
    const writeFileRoute = createRoute({
      method: 'put',
      path: `/{id}/agent/${routeNoun}`,
      tags: [tag],
      summary: 'Write (create or overwrite) a file',
      security: [{ bearerAuth: [] }],
      request: {
        params: WorkspaceIdParam,
        query: PathQuery,
        body: {
          description: 'File contents',
          content: { 'application/octet-stream': { schema: BinarySchema } },
        },
      },
      responses: {
        200: {
          description: 'File written',
          content: { 'application/json': { schema: SuccessSchema } },
        },
        404: {
          description: 'Workspace not found',
          content: { 'application/json': { schema: ErrorSchema } },
        },
        502: {
          description: 'Agent unavailable',
          content: { 'application/json': { schema: ErrorSchema } },
        },
        503: {
          description: 'Workspace not running',
          content: { 'application/json': { schema: ErrorSchema } },
        },
      },
    })
    agent.openapi(writeFileRoute, async (c) => {
      const { id } = c.req.valid('param')
      const resolved = await resolveWorkspace(id, c.get('user'))
      if ('error' in resolved) {
        if (resolved.error === 'not-found') return c.json({ error: 'Workspace not found' }, 404)
        return c.json({ error: 'Workspace not running' }, 503)
      }
      const { path } = c.req.valid('query')
      const body = c.req.raw.body ?? undefined
      const result = await proxyFetch('PUT', buildDufsUrl(resolved.address, path), {
        body: body as BodyInit | undefined,
        headers: { 'Content-Type': c.req.header('Content-Type') || 'application/octet-stream' },
        signal: c.req.raw.signal,
      })
      if (!result.ok) return c.json({ error: result.error }, 502)
      const { response } = result
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        return c.json({ error: text || `Agent returned ${response.status}` }, 502)
      }
      return c.json({ success: true }, 200)
    })

    // ── DELETE /{id}/agent/<routeNoun>?path=... — delete file or dir ─────
    const deleteRoute = createRoute({
      method: 'delete',
      path: `/{id}/agent/${routeNoun}`,
      tags: [tag],
      summary: 'Delete a file or directory (recursive)',
      security: [{ bearerAuth: [] }],
      request: { params: WorkspaceIdParam, query: PathQuery },
      responses: {
        200: { description: 'Deleted', content: { 'application/json': { schema: SuccessSchema } } },
        404: {
          description: 'Workspace not found',
          content: { 'application/json': { schema: ErrorSchema } },
        },
        502: {
          description: 'Agent unavailable',
          content: { 'application/json': { schema: ErrorSchema } },
        },
        503: {
          description: 'Workspace not running',
          content: { 'application/json': { schema: ErrorSchema } },
        },
      },
    })
    agent.openapi(deleteRoute, async (c) => {
      const { id } = c.req.valid('param')
      const resolved = await resolveWorkspace(id, c.get('user'))
      if ('error' in resolved) {
        if (resolved.error === 'not-found') return c.json({ error: 'Workspace not found' }, 404)
        return c.json({ error: 'Workspace not running' }, 503)
      }
      const { path } = c.req.valid('query')
      const result = await proxyFetch('DELETE', buildDufsUrl(resolved.address, path), {
        signal: c.req.raw.signal,
      })
      if (!result.ok) return c.json({ error: result.error }, 502)
      const { response } = result
      if (!response.ok && response.status !== 404) {
        const text = await response.text().catch(() => '')
        return c.json({ error: text || `Agent returned ${response.status}` }, 502)
      }
      return c.json({ success: true }, 200)
    })

    // ── GET /{id}/agent/<dirsNoun>?path=... — list directory ─────────────
    const listDirRoute = createRoute({
      method: 'get',
      path: `/{id}/agent/${dirsNoun}`,
      tags: [tag],
      summary: 'List directory entries',
      security: [{ bearerAuth: [] }],
      request: { params: WorkspaceIdParam, query: DirListQuery },
      responses: {
        200: {
          description: 'Directory entries',
          content: { 'application/json': { schema: AgentDirListingSchema } },
        },
        404: {
          description: 'Workspace or directory not found',
          content: { 'application/json': { schema: ErrorSchema } },
        },
        502: {
          description: 'Agent unavailable',
          content: { 'application/json': { schema: ErrorSchema } },
        },
        503: {
          description: 'Workspace not running',
          content: { 'application/json': { schema: ErrorSchema } },
        },
      },
    })
    agent.openapi(listDirRoute, async (c) => {
      const { id } = c.req.valid('param')
      const resolved = await resolveWorkspace(id, c.get('user'))
      if ('error' in resolved) {
        if (resolved.error === 'not-found') return c.json({ error: 'Workspace not found' }, 404)
        return c.json({ error: 'Workspace not running' }, 503)
      }
      const { path, q } = c.req.valid('query')
      const search = q ? `?q=${encodeURIComponent(q)}&json` : '?json'
      const result = await proxyFetch('GET', buildDufsUrl(resolved.address, path, search), {
        signal: c.req.raw.signal,
      })
      if (!result.ok) return c.json({ error: result.error }, 502)
      const { response } = result
      if (response.status === 404) return c.json({ error: 'Directory not found' }, 404)
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        return c.json({ error: text || `Agent returned ${response.status}` }, 502)
      }
      const raw = (await response.json().catch(() => null)) as unknown
      // dufs returns a JSON listing only for directories. For a file, the
      // `?json` query is ignored and the file's contents come back — which
      // fails to parse (raw === null) or parses into something that isn't a
      // listing. Surface that as 404 so callers (e.g. the markdown link
      // probe) can distinguish file vs directory.
      const isListing =
        Array.isArray(raw) ||
        (raw !== null &&
          typeof raw === 'object' &&
          'paths' in raw &&
          Array.isArray((raw as { paths: unknown }).paths))
      if (!isListing) return c.json({ error: 'Not a directory' }, 404)
      const list = Array.isArray(raw) ? raw : (raw as { paths: unknown[] }).paths
      return c.json({ entries: list }, 200)
    })

    // ── GET /{id}/agent/<dirsNoun>/zip?path=... — zip download ───────────
    const dirZipRoute = createRoute({
      method: 'get',
      path: `/{id}/agent/${dirsNoun}/zip`,
      tags: [tag],
      summary: 'Download a directory as a zip archive',
      security: [{ bearerAuth: [] }],
      request: { params: WorkspaceIdParam, query: PathQuery },
      responses: {
        200: {
          description: 'Zip archive',
          content: { 'application/zip': { schema: BinarySchema } },
        },
        404: {
          description: 'Workspace not found',
          content: { 'application/json': { schema: ErrorSchema } },
        },
        502: {
          description: 'Agent unavailable',
          content: { 'application/json': { schema: ErrorSchema } },
        },
        503: {
          description: 'Workspace not running',
          content: { 'application/json': { schema: ErrorSchema } },
        },
      },
    })
    agent.openapi(dirZipRoute, async (c) => {
      const { id } = c.req.valid('param')
      const resolved = await resolveWorkspace(id, c.get('user'))
      if ('error' in resolved) {
        if (resolved.error === 'not-found') return c.json({ error: 'Workspace not found' }, 404)
        return c.json({ error: 'Workspace not running' }, 503)
      }
      const { path } = c.req.valid('query')
      const result = await proxyFetch('GET', buildDufsUrl(resolved.address, path, '?zip'), {
        signal: c.req.raw.signal,
      })
      if (!result.ok) return c.json({ error: result.error }, 502)
      const { response } = result
      const headers: Record<string, string> = {
        'Content-Type': response.headers.get('Content-Type') || 'application/zip',
      }
      const cd = response.headers.get('Content-Disposition')
      if (cd) headers['Content-Disposition'] = cd
      return new Response(response.body, { status: response.status, headers })
    })

    // ── POST /{id}/agent/<dirsNoun> — mkdir ──────────────────────────────
    const mkdirRoute = createRoute({
      method: 'post',
      path: `/{id}/agent/${dirsNoun}`,
      tags: [tag],
      summary: 'Create a directory',
      security: [{ bearerAuth: [] }],
      request: {
        params: WorkspaceIdParam,
        body: { content: { 'application/json': { schema: AgentMkdirBodySchema } } },
      },
      responses: {
        201: {
          description: 'Directory created',
          content: { 'application/json': { schema: SuccessSchema } },
        },
        404: {
          description: 'Workspace not found',
          content: { 'application/json': { schema: ErrorSchema } },
        },
        409: {
          description: 'Directory already exists',
          content: { 'application/json': { schema: ErrorSchema } },
        },
        502: {
          description: 'Agent unavailable',
          content: { 'application/json': { schema: ErrorSchema } },
        },
        503: {
          description: 'Workspace not running',
          content: { 'application/json': { schema: ErrorSchema } },
        },
      },
    })
    agent.openapi(mkdirRoute, async (c) => {
      const { id } = c.req.valid('param')
      const resolved = await resolveWorkspace(id, c.get('user'))
      if ('error' in resolved) {
        if (resolved.error === 'not-found') return c.json({ error: 'Workspace not found' }, 404)
        return c.json({ error: 'Workspace not running' }, 503)
      }
      const { path } = c.req.valid('json')
      const normalized = path.endsWith('/') ? path : `${path}/`
      const result = await proxyFetch('MKCOL', buildDufsUrl(resolved.address, normalized), {
        signal: c.req.raw.signal,
      })
      if (!result.ok) return c.json({ error: result.error }, 502)
      const { response } = result
      if (response.status === 405 || response.status === 409) {
        return c.json({ error: 'Directory already exists' }, 409)
      }
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        return c.json({ error: text || `Agent returned ${response.status}` }, 502)
      }
      return c.json({ success: true }, 201)
    })

    // ── POST /{id}/agent/<moveNoun> — move/rename ────────────────────────
    const moveRoute = createRoute({
      method: 'post',
      path: `/{id}/agent/${moveNoun}`,
      tags: [tag],
      summary: 'Move or rename a file or directory',
      security: [{ bearerAuth: [] }],
      request: {
        params: WorkspaceIdParam,
        body: { content: { 'application/json': { schema: AgentMoveBodySchema } } },
      },
      responses: {
        200: { description: 'Moved', content: { 'application/json': { schema: SuccessSchema } } },
        404: {
          description: 'Workspace or source not found',
          content: { 'application/json': { schema: ErrorSchema } },
        },
        502: {
          description: 'Agent unavailable',
          content: { 'application/json': { schema: ErrorSchema } },
        },
        503: {
          description: 'Workspace not running',
          content: { 'application/json': { schema: ErrorSchema } },
        },
      },
    })
    agent.openapi(moveRoute, async (c) => {
      const { id } = c.req.valid('param')
      const resolved = await resolveWorkspace(id, c.get('user'))
      if ('error' in resolved) {
        if (resolved.error === 'not-found') return c.json({ error: 'Workspace not found' }, 404)
        return c.json({ error: 'Workspace not running' }, 503)
      }
      const { src, dest } = c.req.valid('json')
      const encodedDest = dest
        .replace(/^\//, '')
        .split('/')
        .map((seg) => encodeURIComponent(seg))
        .join('/')
      const result = await proxyFetch('MOVE', buildDufsUrl(resolved.address, src), {
        headers: { Destination: `${dufsPrefix}/${encodedDest}` },
        signal: c.req.raw.signal,
      })
      if (!result.ok) return c.json({ error: result.error }, 502)
      const { response } = result
      if (response.status === 404) return c.json({ error: 'Source not found' }, 404)
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        return c.json({ error: text || `Agent returned ${response.status}` }, 502)
      }
      return c.json({ success: true }, 200)
    })
  }

  // Workspace files (existing routes preserved — same paths, same dufs).
  registerFileRoutes({
    tag: 'agent-files',
    fsDescription: 'workspace filesystem',
    routeNoun: 'files',
    dirsNoun: 'dirs',
    moveNoun: 'move',
    dufsPrefix: '/files',
  })

  // AgentFS (shared mounts under /mnt/afs via second dufs on agent pod).
  registerFileRoutes({
    tag: 'agent-afs-files',
    fsDescription: 'AgentFS shared mounts (/mnt/afs)',
    routeNoun: 'afs-files',
    dirsNoun: 'afs-dirs',
    moveNoun: 'afs-move',
    dufsPrefix: '/afs-files',
  })

  // ── POST /{id}/agent/export-url — mint public URL for a workspace file ──
  //
  // UI-facing equivalent of the export_file_url MCP tool. Returns a
  // short-lived public URL the browser can open directly (e.g. to preview
  // a generated HTML report in a new tab). Workspace drive only — the
  // public-exports app forwards to the workspace dufs at /files, AFS
  // mounts aren't reachable through that pipeline.
  // Public URL for an export token. A folder points at its root (trailing
  // slash) so sub-paths under it are addressable; a file ends with the
  // filename so clients that infer names from the URL tail get it right.
  const exportPublicUrl = (publicUrl: string, token: string, path: string, kind: 'file' | 'dir') =>
    kind === 'dir'
      ? `${publicUrl}/${token}/`
      : `${publicUrl}/${token}/${encodeURIComponent(path.split('/').pop() || 'file')}`

  const ExportUrlBodySchema = z.object({
    path: z.string().min(1),
    ttl_seconds: z.number().int().min(1).max(3600).optional(),
    // When true, mint a never-expiring URL. ttl_seconds is ignored.
    permanent: z.boolean().optional(),
    // When true, the path is a directory: the public URL serves a zip archive.
    // The UI knows the entry kind, so it tells us rather than us re-probing dufs.
    is_dir: z.boolean().optional(),
  })
  const ExportUrlResponseSchema = z.object({
    url: z.string(),
    // `null` when the URL is permanent.
    expires_at: z.string().nullable(),
  })
  const exportUrlRoute = createRoute({
    method: 'post',
    path: '/{id}/agent/export-url',
    tags: ['agent-files'],
    summary: 'Mint a short-lived public URL for a workspace file',
    security: [{ bearerAuth: [] }],
    request: {
      params: WorkspaceIdParam,
      body: { content: { 'application/json': { schema: ExportUrlBodySchema } } },
    },
    responses: {
      200: {
        description: 'Public URL minted',
        content: { 'application/json': { schema: ExportUrlResponseSchema } },
      },
      400: {
        description: 'Invalid path or service misconfigured',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      404: {
        description: 'Workspace not found',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      503: {
        description: 'Workspace not running',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  })
  agent.openapi(exportUrlRoute, async (c) => {
    const { id } = c.req.valid('param')
    const resolved = await resolveWorkspace(id, c.get('user'))
    if ('error' in resolved) {
      if (resolved.error === 'not-found') return c.json({ error: 'Workspace not found' }, 404)
      return c.json({ error: 'Workspace not running' }, 503)
    }
    const publicUrl = process.env.FILES_PUBLIC_URL
    if (!publicUrl) return c.json({ error: 'FILES_PUBLIC_URL is not configured' }, 400)
    const { path, ttl_seconds, permanent, is_dir } = c.req.valid('json')
    const normalized = path.replace(/^\/+/, '')
    if (!normalized) return c.json({ error: 'Path is empty' }, 400)
    if (normalized.includes('..')) return c.json({ error: 'Path must not contain ".."' }, 400)
    const ttl = permanent ? null : (ttl_seconds ?? 3600)
    const record = await createExportToken(
      resolved.workspace.id,
      normalized,
      ttl,
      is_dir ? 'dir' : 'file',
    )
    const url = exportPublicUrl(publicUrl, record.token, normalized, record.kind)
    return c.json(
      { url, expires_at: record.expires_at ? record.expires_at.toISOString() : null },
      200,
    )
  })

  // ── GET /{id}/agent/export-tokens — list active public links ─────────────
  //
  // Returns active (non-expired) tokens for the workspace so the UI can
  // surface a "Manage public links" view. Works regardless of workspace
  // run state — we only hit the DB.
  const ExportTokenSchema = z.object({
    token: z.string(),
    path: z.string(),
    url: z.string(),
    created_at: z.string(),
    expires_at: z.string().nullable(),
  })
  const ListExportTokensResponseSchema = z.object({
    tokens: z.array(ExportTokenSchema),
  })
  const listExportTokensRoute = createRoute({
    method: 'get',
    path: '/{id}/agent/export-tokens',
    tags: ['agent-files'],
    summary: 'List active public file URLs for a workspace',
    security: [{ bearerAuth: [] }],
    request: { params: WorkspaceIdParam },
    responses: {
      200: {
        description: 'Active tokens',
        content: { 'application/json': { schema: ListExportTokensResponseSchema } },
      },
      404: {
        description: 'Workspace not found',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  })
  agent.openapi(listExportTokensRoute, async (c) => {
    const { id } = c.req.valid('param')
    const workspace = await getWorkspace(id)
    if (!workspace || !canManage(workspace, c.get('user'))) {
      return c.json({ error: 'Workspace not found' }, 404)
    }
    const publicUrl = process.env.FILES_PUBLIC_URL ?? ''
    const records = await listExportTokens(workspace.id)
    const tokens = records.map((r) => {
      return {
        token: r.token,
        path: r.path,
        url: publicUrl ? exportPublicUrl(publicUrl, r.token, r.path, r.kind) : '',
        created_at: r.created_at.toISOString(),
        expires_at: r.expires_at ? r.expires_at.toISOString() : null,
      }
    })
    return c.json({ tokens }, 200)
  })

  // ── DELETE /{id}/agent/export-tokens/{token} — revoke a public link ───────
  const RevokeTokenParam = WorkspaceIdParam.extend({
    token: z.string().min(1).openapi({ param: { name: 'token', in: 'path' } }),
  })
  const revokeExportTokenRoute = createRoute({
    method: 'delete',
    path: '/{id}/agent/export-tokens/{token}',
    tags: ['agent-files'],
    summary: 'Revoke (hard-delete) a public file URL',
    security: [{ bearerAuth: [] }],
    request: { params: RevokeTokenParam },
    responses: {
      204: { description: 'Revoked' },
      404: {
        description: 'Workspace or token not found',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  })
  agent.openapi(revokeExportTokenRoute, async (c) => {
    const { id, token } = c.req.valid('param')
    const workspace = await getWorkspace(id)
    if (!workspace || !canManage(workspace, c.get('user'))) {
      return c.json({ error: 'Workspace not found' }, 404)
    }
    const removed = await deleteExportToken(workspace.id, token)
    if (!removed) return c.json({ error: 'Token not found' }, 404)
    return c.body(null, 204)
  })

  // ── GET /{id}/agent/terminal/ws — WebSocket passthrough ─────────────────
  //
  // Not documented via OpenAPI (WS isn't expressible). ACL is inline,
  // no service-token bypass — identical to the legacy /_proxy/agent
  // terminal handler, just remounted under /api/workspaces/:id/agent.

  // Reject anything that isn't a safe tmux session name before forwarding —
  // even though the agent server validates again, a defense-in-depth check
  // here keeps clearly-bogus values from ever leaving the cp process.
  const TERMINAL_SESSION_RE = /^[A-Za-z0-9_-]{1,64}$/

  agent.get(
    '/:id/agent/terminal/ws',
    upgradeWebSocket((c) => {
      const workspaceId = c.req.param('id')!
      const rawSession = c.req.query('session')
      const session = rawSession && TERMINAL_SESSION_RE.test(rawSession) ? rawSession : undefined

      let backend: WebSocket | null = null
      let backendReady = false
      const pendingMessages: (string | ArrayBuffer)[] = []

      return {
        async onOpen(_evt, ws) {
          try {
            const currentUser = c.get('user')
            const workspace = await getWorkspace(workspaceId)
            if (
              !workspace ||
              !canManage(workspace, currentUser) ||
              workspace.status !== 'running'
            ) {
              ws.close(1008, 'Workspace not available')
              return
            }

            const address = getWorkspaceAddress(workspace.id)
            const wsUrl = `${address.replace(/^http/, 'ws')}/terminal/ws${
              session ? `?session=${encodeURIComponent(session)}` : ''
            }`
            backend = new WebSocket(wsUrl)
            backend.binaryType = 'arraybuffer'

            backend.addEventListener('open', () => {
              backendReady = true
              for (const msg of pendingMessages) {
                backend!.send(msg)
              }
              pendingMessages.length = 0
            })
            backend.addEventListener('message', (evt) => {
              const data = evt.data
              if (data instanceof ArrayBuffer) {
                ws.send(new Uint8Array(data))
              } else {
                ws.send(data)
              }
            })
            backend.addEventListener('close', () => ws.close())
            backend.addEventListener('error', () => ws.close())
          } catch {
            ws.close(1011, 'Internal error')
          }
        },
        onMessage(evt) {
          const data = evt.data
          if (backendReady && backend?.readyState === WebSocket.OPEN) {
            backend.send(data as string | ArrayBuffer)
          } else {
            pendingMessages.push(data as string | ArrayBuffer)
          }
        },
        onClose() {
          if (backend?.readyState === WebSocket.OPEN) backend.close()
          backend = null
        },
        onError() {
          if (backend?.readyState === WebSocket.OPEN) backend.close()
          backend = null
        },
      }
    }),
  )

  return agent
}
