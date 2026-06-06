import { Hono } from 'hono'
import { getWorkspaceAddress } from '../lib/workspace-address'
import { getActiveExportToken } from '../services/db/export-tokens'
import { pool } from '../services/db/pool'
import { getActiveSessionExportToken } from '../services/db/session-export-tokens'
import { getWorkspace } from '../services/db/workspaces'

/**
 * Public file export sub-app. Mounted on files.* hostnames and bypasses
 * the main app's auth middleware entirely — access control is the
 * unguessability of the token (128-bit random, TTL-bounded, issued by
 * the export_file_url MCP tool).
 *
 * URL shape: https://<files-host>/<token>/<filename>[?dl=1]
 *   - <token> is the only authenticator
 *   - <filename> is cosmetic; downstream clients (Google Drive upload,
 *     curl -O, browsers) use the URL tail to infer the filename when
 *     Content-Disposition isn't honored. Not validated server-side.
 *   - Default disposition is `inline` so browsers preview renderable
 *     content (HTML / images / PDF / text). Append `?dl=1` to force
 *     `attachment`. The `files.*` host is intentionally a separate
 *     origin from the main app so inline HTML can't reach app cookies.
 */
export const publicExportsApp = new Hono()

/**
 * Session transcript export. Bearer-by-URL like file exports above, but the
 * target is a `sessions` row rather than a dufs path: token resolves to
 * `(workspace_id, session_id)` and the body is the session's full transcript
 * as JSONL — messages and session_events interleaved by `created_at`.
 *
 * One line per record. Each line carries a `type` discriminator:
 *   - `{"type":"message", id, role, content, blocks?, created_at}`
 *     `blocks` is parsed JSON when the legacy column is non-empty; new rows
 *     emit detail via the event stream below.
 *   - `{"type":"event", id, message_id, kind, call_id, payload, created_at}`
 *     `kind` is e.g. text / tool_call / tool_result; `payload` is the raw
 *     jsonb (parsed). This is where tool-call evidence lives — important
 *     for "review my last few chats to refine the prompt" use cases.
 *
 * Streamed via `transformToReadable`: we open one cursor per relation and
 * merge them in JS by created_at, so the response body stays bounded even
 * on large sessions.
 */
publicExportsApp.get('/session/:token', async (c) => {
  const token = c.req.param('token')
  const record = await getActiveSessionExportToken(token)
  if (!record) return c.text('Not found or expired', 404)

  const [messagesRes, eventsRes] = await Promise.all([
    pool.query(
      `SELECT id, role, content, blocks, created_at
         FROM messages
        WHERE workspace_id = $1 AND session_id = $2
        ORDER BY created_at ASC`,
      [record.workspace_id, record.session_id],
    ),
    pool.query(
      `SELECT id, message_id, kind, call_id, payload, created_at
         FROM session_events
        WHERE session_id = $1
        ORDER BY created_at ASC, id ASC`,
      [record.session_id],
    ),
  ])

  // Merge messages and events by created_at, oldest first. Stable on ties
  // by emitting the matching message line before its event children.
  const lines: string[] = []
  let mi = 0
  let ei = 0
  const msgs = messagesRes.rows as Array<{
    id: string
    role: string
    content: string
    blocks: string | null
    created_at: Date | string
  }>
  const events = eventsRes.rows as Array<{
    id: string
    message_id: string
    kind: string
    call_id: string | null
    payload: unknown
    created_at: Date | string
  }>
  function ts(v: Date | string): number {
    return v instanceof Date ? v.getTime() : new Date(v).getTime()
  }
  while (mi < msgs.length || ei < events.length) {
    const mNext = mi < msgs.length ? ts(msgs[mi].created_at) : Number.POSITIVE_INFINITY
    const eNext = ei < events.length ? ts(events[ei].created_at) : Number.POSITIVE_INFINITY
    if (mNext <= eNext) {
      const m = msgs[mi++]
      let parsedBlocks: unknown
      if (m.blocks?.trim() && m.blocks.trim() !== '[]') {
        try {
          parsedBlocks = JSON.parse(m.blocks)
        } catch {
          parsedBlocks = m.blocks
        }
      }
      lines.push(
        JSON.stringify({
          type: 'message',
          id: m.id,
          role: m.role,
          content: m.content,
          ...(parsedBlocks !== undefined ? { blocks: parsedBlocks } : {}),
          created_at:
            m.created_at instanceof Date ? m.created_at.toISOString() : String(m.created_at),
        }),
      )
    } else {
      const e = events[ei++]
      lines.push(
        JSON.stringify({
          type: 'event',
          id: e.id,
          message_id: e.message_id,
          kind: e.kind,
          call_id: e.call_id,
          payload: e.payload,
          created_at:
            e.created_at instanceof Date ? e.created_at.toISOString() : String(e.created_at),
        }),
      )
    }
  }
  const body = lines.length > 0 ? `${lines.join('\n')}\n` : ''

  console.log(
    `[public-exports] serve session token=${token} ws=${record.workspace_id} ` +
      `session=${record.session_id} lines=${lines.length} ` +
      `ip=${c.req.header('x-forwarded-for') || 'unknown'} ua=${c.req.header('user-agent') || '-'}`,
  )

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Content-Disposition': `attachment; filename="${record.session_id}.jsonl"`,
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex',
    },
  })
})

publicExportsApp.get('/:token/:filename{.*}', async (c) => {
  const token = c.req.param('token')
  const record = await getActiveExportToken(token)
  if (!record) return c.text('Not found or expired', 404)

  const workspace = await getWorkspace(record.workspace_id)
  if (!workspace) return c.text('Workspace not found', 404)
  if (workspace.status !== 'running') return c.text('Workspace not running', 503)
  const address = getWorkspaceAddress(workspace.id)

  const trimmed = record.path.replace(/^\//, '')
  const encoded = trimmed
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')
  const dufsUrl = `${address}/files/${encoded}`

  let upstream: Response
  try {
    upstream = await fetch(dufsUrl, { signal: c.req.raw.signal })
  } catch (e: any) {
    if (c.req.raw.signal.aborted) return c.text('Client disconnected', 408)
    console.error(`[public-exports] fetch failed ${dufsUrl}:`, e.message)
    return c.text('Agent unavailable', 502)
  }
  if (!upstream.ok) {
    return c.text(`Upstream ${upstream.status}`, upstream.status === 404 ? 404 : 502)
  }

  const basename = trimmed.split('/').pop() || 'file'
  const asciiFallback = basename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_')
  const disposition = c.req.query('dl') === '1' ? 'attachment' : 'inline'
  const headers: Record<string, string> = {
    'Content-Type': upstream.headers.get('Content-Type') || 'application/octet-stream',
    'Content-Disposition': `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(basename)}`,
    'Cache-Control': 'private, no-store',
    'X-Robots-Tag': 'noindex',
  }
  const cl = upstream.headers.get('Content-Length')
  if (cl) headers['Content-Length'] = cl

  console.log(
    `[public-exports] serve token=${token} ws=${record.workspace_id} path=${record.path} ` +
      `ip=${c.req.header('x-forwarded-for') || 'unknown'} ua=${c.req.header('user-agent') || '-'}`,
  )
  return new Response(upstream.body, { status: 200, headers })
})

publicExportsApp.all('*', (c) => c.text('Not found', 404))
