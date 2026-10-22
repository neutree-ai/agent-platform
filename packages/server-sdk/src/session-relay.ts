// Relays the UI SDK's session calls to the platform, as the signed-in person.
//
// The browser never talks to the platform: it calls your backend under the
// paths the UI SDK's session store uses, and this passes each call on with the
// person's own token. Whatever workspace the page names is only a key your
// `resolve` maps to one of the person's own workspaces, so a page can't reach
// anyone else's. Point the UI SDK at the mount point:
//
//   configureSessionEndpoints({ apiUrl: '/api/nap', proxyUrl: '/api/nap/_proxy' })
//
// Paths, relative to `basePath`:
//   GET    /workspaces/:w/sessions/:sid                    the session
//   GET    /workspaces/:w/messages?session_id=             its messages
//   GET    /workspaces/:w/messages/:mid/blocks/:n/image    an image they hold
//   PUT    /workspaces/:w/sessions/:sid/pending            a queued follow-up
//   DELETE /workspaces/:w/sessions/:sid/pending
//   POST   /workspaces/:w/sessions/:sid/interrupt
//   POST   /workspaces/:w/chat                             a turn, streamed
//   POST   /_proxy/agent/:w/cp-reconnect                   the running turn, streamed
//   GET    /_proxy/agent/:w/sessions/:sid/pending-question
//   POST   /_proxy/agent/:w/sessions/:sid/respond

import { type NapClient, workspacePath } from './client.js'

export interface RelayTarget {
  /** A client acting as the signed-in person, e.g. AppClient.as(externalId). */
  client: NapClient
  /** The person's platform workspace the call goes to. */
  workspaceId: string
}

export interface SessionTurn {
  sessionId: string
  /** The message the turn was sent with. */
  message: string
  /** Whether the turn opened the session. */
  isNew: boolean
}

export interface SessionRelayOptions<Ctx> {
  /** Where the relay is mounted, the UI SDK's `apiUrl`, e.g. '/api/nap'. */
  basePath: string
  /**
   * The person's client and workspace for the workspace key the page put in
   * the path. Return a Response (e.g. 403 or 404) to refuse the call.
   */
  resolve(ctx: Ctx, workspace: string): Promise<RelayTarget | Response>
  /**
   * Check a message body (a turn, or a queued follow-up) before it is sent.
   * Return an error text to refuse it with 400.
   */
  checkMessage?(body: string): string | undefined
  /** Largest message body accepted, in bytes. Default 20 MiB. */
  maxBodyBytes?: number
  /**
   * Told about every turn sent: straight away for an existing session, and
   * once the platform names it for a session the turn opens. Errors are
   * logged, never passed to the page.
   */
  onTurn?(ctx: Ctx, turn: SessionTurn): void | Promise<void>
  /** Error texts the page is shown. */
  errors?: { tooLarge?: string; notFound?: string }
}

export interface SessionRelay<Ctx> {
  /** Answer one call. `request` is the incoming one; `ctx` is passed to resolve and onTurn. */
  handle(request: Request, ctx: Ctx): Promise<Response>
}

const DEFAULT_MAX_BODY = 20 * 1024 * 1024
const JSON_TYPE = { 'Content-Type': 'application/json' }

// The platform's answer as it is: status, type, body. A stream is passed on as
// it comes.
function relay(res: Response): Response {
  const type = res.headers.get('Content-Type') ?? 'application/json'
  const headers: Record<string, string> = { 'Content-Type': type }
  if (type.includes('text/event-stream')) {
    headers['Cache-Control'] = 'no-cache'
    // Keeps a proxy in front from holding the frames back.
    headers['X-Accel-Buffering'] = 'no'
  }
  return new Response(res.body, { status: res.status, headers })
}

const errorResponse = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), { status, headers: JSON_TYPE })

// The body as text, or null once it passes `max` bytes; a huge one is never held.
async function readCapped(request: Request, max: number): Promise<string | null> {
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

// Reads a turn's stream only until `session.started` names the session.
async function sessionStarted(stream: ReadableStream<Uint8Array>): Promise<string | null> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return null
      buffer += decoder.decode(value, { stream: true })
      const match = buffer.match(/"type":"session\.started"[^\n]*?"session_id":"([^"]+)"/)
      if (match) return match[1]
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
}

// A stored image is addressed under the platform's own path for the
// workspace, which the page can't reach. Point it at the relay instead.
const STORED_IMAGE = /^\/api\/workspaces\/[^/]+\/(messages\/[^/]+\/blocks\/\d+\/image)$/
const IMAGE_TYPE = /^image\/(png|jpeg|webp|gif)$/

function imagesHere(messages: unknown, base: string): unknown {
  if (!Array.isArray(messages)) return messages
  for (const message of messages) {
    if (!Array.isArray(message?.blocks)) continue
    for (const block of message.blocks) {
      const match = typeof block?.url === 'string' && STORED_IMAGE.exec(block.url)
      if (match) block.url = `${base}/${match[1]}`
    }
  }
  return messages
}

type Route = {
  method: string
  pattern: RegExp
  run(args: {
    request: Request
    url: URL
    params: string[]
    target: RelayTarget
    workspace: string
    ctx: unknown
  }): Promise<Response>
}

export function createSessionRelay<Ctx = void>(
  options: SessionRelayOptions<Ctx>,
): SessionRelay<Ctx> {
  const basePath = options.basePath.replace(/\/+$/, '')
  const maxBody = options.maxBodyBytes ?? DEFAULT_MAX_BODY
  const tooLarge = options.errors?.tooLarge ?? 'Message too large'
  const notFound = options.errors?.notFound ?? 'Not found'

  // A message body, checked; or the answer refusing it.
  async function message(request: Request): Promise<string | Response> {
    const body = await readCapped(request, maxBody)
    if (body === null) return errorResponse(413, tooLarge)
    const problem = options.checkMessage?.(body)
    return problem ? errorResponse(400, problem) : body
  }

  async function notify(ctx: Ctx, turn: SessionTurn) {
    try {
      await options.onTurn?.(ctx, turn)
    } catch (err) {
      console.error('[session-relay] onTurn failed:', err)
    }
  }

  const session = (t: RelayTarget, sid: string) =>
    `${workspacePath(t.workspaceId)}/sessions/${encodeURIComponent(sid)}`
  const agent = (t: RelayTarget) => `/_proxy/agent/${encodeURIComponent(t.workspaceId)}`

  const routes: Route[] = [
    {
      method: 'GET',
      pattern: /^\/workspaces\/([^/]+)\/sessions\/([^/]+)$/,
      run: async ({ target, params }) =>
        relay(await target.client.forward('GET', session(target, params[1]))),
    },
    {
      method: 'GET',
      pattern: /^\/workspaces\/([^/]+)\/messages$/,
      run: async ({ target, url, workspace }) => {
        const query = new URLSearchParams()
        for (const key of ['session_id', 'limit', 'offset']) {
          const value = url.searchParams.get(key)
          if (value !== null) query.set(key, value)
        }
        const res = await target.client.forward(
          'GET',
          `${workspacePath(target.workspaceId)}/messages?${query}`,
        )
        if (!res.ok) return relay(res)
        const base = `${basePath}/workspaces/${encodeURIComponent(workspace)}`
        return new Response(JSON.stringify(imagesHere(await res.json(), base)), {
          headers: JSON_TYPE,
        })
      },
    },
    {
      method: 'GET',
      pattern: /^\/workspaces\/([^/]+)\/messages\/([^/]+)\/blocks\/(\d+)\/image$/,
      run: async ({ target, params }) => {
        const res = await target.client.forward(
          'GET',
          `${workspacePath(target.workspaceId)}/messages/${encodeURIComponent(params[1])}/blocks/${params[2]}/image`,
        )
        const type = res.headers.get('Content-Type') ?? ''
        if (!res.ok || !IMAGE_TYPE.test(type)) {
          await res.body?.cancel()
          return errorResponse(404, notFound)
        }
        // The bytes as they are, for the page to show and not to run.
        return new Response(res.body, {
          headers: {
            'Content-Type': type,
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "sandbox; default-src 'none'",
            'Cache-Control': 'private, max-age=3600',
          },
        })
      },
    },
    {
      method: 'PUT',
      pattern: /^\/workspaces\/([^/]+)\/sessions\/([^/]+)\/pending$/,
      run: async ({ request, target, params }) => {
        const body = await message(request)
        if (body instanceof Response) return body
        return relay(
          await target.client.forward('PUT', `${session(target, params[1])}/pending`, {
            body,
            headers: JSON_TYPE,
          }),
        )
      },
    },
    {
      method: 'DELETE',
      pattern: /^\/workspaces\/([^/]+)\/sessions\/([^/]+)\/pending$/,
      run: async ({ target, params }) =>
        relay(await target.client.forward('DELETE', `${session(target, params[1])}/pending`)),
    },
    {
      method: 'POST',
      pattern: /^\/workspaces\/([^/]+)\/sessions\/([^/]+)\/interrupt$/,
      run: async ({ target, params }) =>
        relay(
          await target.client.forward('POST', `${session(target, params[1])}/interrupt`, {
            body: '{}',
            headers: JSON_TYPE,
          }),
        ),
    },
    {
      method: 'POST',
      pattern: /^\/workspaces\/([^/]+)\/chat$/,
      run: async ({ request, target, ctx }) => {
        const body = await message(request)
        if (body instanceof Response) return body
        const res = await target.client.forward(
          'POST',
          `${workspacePath(target.workspaceId)}/chat`,
          { body, headers: JSON_TYPE, signal: request.signal },
        )
        if (!options.onTurn || !res.ok || !res.body) return relay(res)

        let turn: { message?: unknown; session_id?: unknown } = {}
        try {
          turn = JSON.parse(body)
        } catch {}
        const text = typeof turn.message === 'string' ? turn.message : ''
        if (typeof turn.session_id === 'string' && turn.session_id) {
          await notify(ctx as Ctx, { sessionId: turn.session_id, message: text, isNew: false })
          return relay(res)
        }
        const [toPage, toWatch] = res.body.tee()
        void sessionStarted(toWatch)
          .then((sessionId) => {
            if (sessionId) return notify(ctx as Ctx, { sessionId, message: text, isNew: true })
          })
          .catch((err) => console.error('[session-relay] reading the turn failed:', err))
        return relay(new Response(toPage, { status: res.status, headers: res.headers }))
      },
    },
    {
      method: 'POST',
      pattern: /^\/_proxy\/agent\/([^/]+)\/cp-reconnect$/,
      run: async ({ request, url, target }) => {
        const sid = url.searchParams.get('session_id')
        const query = sid ? `?session_id=${encodeURIComponent(sid)}` : ''
        return relay(
          await target.client.forward('POST', `${agent(target)}/cp-reconnect${query}`, {
            signal: request.signal,
          }),
        )
      },
    },
    {
      method: 'GET',
      pattern: /^\/_proxy\/agent\/([^/]+)\/sessions\/([^/]+)\/pending-question$/,
      run: async ({ target, params }) =>
        relay(
          await target.client.forward(
            'GET',
            `${agent(target)}/sessions/${encodeURIComponent(params[1])}/pending-question`,
          ),
        ),
    },
    {
      method: 'POST',
      pattern: /^\/_proxy\/agent\/([^/]+)\/sessions\/([^/]+)\/respond$/,
      run: async ({ request, target, params }) =>
        relay(
          await target.client.forward(
            'POST',
            `${agent(target)}/sessions/${encodeURIComponent(params[1])}/respond`,
            { body: await request.text(), headers: JSON_TYPE },
          ),
        ),
    },
  ]

  return {
    async handle(request, ctx) {
      const url = new URL(request.url)
      if (!url.pathname.startsWith(`${basePath}/`)) return errorResponse(404, notFound)
      const path = url.pathname.slice(basePath.length)
      for (const route of routes) {
        if (route.method !== request.method) continue
        const match = route.pattern.exec(path)
        if (!match) continue
        let params: string[]
        try {
          params = match.slice(1).map(decodeURIComponent)
        } catch {
          return errorResponse(404, notFound)
        }
        const [workspace] = params
        const target = await options.resolve(ctx, workspace)
        if (target instanceof Response) return target
        return route.run({ request, url, params, target, workspace, ctx })
      }
      return errorResponse(404, notFound)
    },
  }
}
