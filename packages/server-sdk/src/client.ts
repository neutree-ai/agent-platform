// A client for the platform's REST API, acting as one platform user: every
// call carries that user's token, so it sees and changes only what that user
// can. Get one for a user your application provisioned from
// AppClient.as(externalId).

export class NapError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message)
    this.name = 'NapError'
  }
}

export interface NapSession {
  id: string
  name: string
  /** 'agent' while a turn is running; anything else once it has ended. */
  chat_status: string
  /** Calls to other agents whose results are yet to be delivered to this session. */
  pending_agent_calls?: number
  /** How full the context was at the end of the last turn; null before one. */
  last_turn_stats?: { numTurns: number; contextTokens: number; contextWindow: number } | null
  status: string
  last_active_at: string
}

export interface NapWorkspace {
  id: string
  name: string
  slug: string | null
  status: string
}

export interface NapSessionSummary {
  id: string
  name: string
  /** Who opened it: 'api', 'web', 'schedule', … */
  source: string
  /** Set when another agent opened it with call_agent. */
  caller_agent: string | null
  preview: string | null
  created_at: string
  last_active_at: string
}

export interface ForwardInit {
  body?: BodyInit | null
  headers?: HeadersInit
  /** A page that goes away stops what it was reading, a stream included. */
  signal?: AbortSignal
}

export interface NapClientOptions {
  /** Platform base URL, e.g. https://nap.example.com */
  baseUrl: string
  /** The user's access token, or a function returning a current one. */
  token: string | (() => Promise<string>)
  fetch?: typeof fetch
}

/** API path of a workspace. */
export const workspacePath = (workspaceId: string) =>
  `/api/workspaces/${encodeURIComponent(workspaceId)}`

export class NapClient {
  private readonly baseUrl: string
  private readonly token: () => Promise<string>
  private readonly fetchImpl: typeof fetch
  // Slugs and ids don't change, so each is looked up once per client.
  private readonly workspaceIds = new Map<string, string>()

  constructor(options: NapClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    const { token } = options
    this.token = typeof token === 'string' ? async () => token : token
    this.fetchImpl = options.fetch ?? fetch
  }

  /** A raw call whose response is returned as it is, for relaying. */
  async forward(method: string, path: string, init: ForwardInit = {}): Promise<Response> {
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${await this.token()}`)
    return this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: init.body,
      signal: init.signal,
    })
  }

  /** A JSON call; throws NapError on a non-2xx answer. */
  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.forward(method, path, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new NapError(`${method} ${path} → ${res.status}: ${text.slice(0, 500)}`, res.status)
    }
    if (res.status === 204) return undefined as T
    return (await res.json()) as T
  }

  listWorkspaces() {
    return this.request<NapWorkspace[]>('GET', '/api/workspaces')
  }

  /** The id of the user's workspace with this slug. */
  async workspaceOfSlug(slug: string): Promise<string | undefined> {
    const known = this.workspaceIds.get(slug)
    if (known) return known
    for (const workspace of await this.listWorkspaces()) {
      if (workspace.slug) this.workspaceIds.set(workspace.slug, workspace.id)
    }
    return this.workspaceIds.get(slug)
  }

  getSession(workspaceId: string, sessionId: string) {
    return this.request<NapSession>(
      'GET',
      `${workspacePath(workspaceId)}/sessions/${encodeURIComponent(sessionId)}`,
    )
  }

  /** The workspace's sessions, most recently active first. */
  listSessions(workspaceId: string, limit = 100) {
    return this.request<{ items: NapSessionSummary[]; total: number }>(
      'GET',
      `${workspacePath(workspaceId)}/sessions?limit=${limit}`,
    )
  }

  /** A session's messages, in the shape the UI SDK and readTranscript take. */
  listMessages(workspaceId: string, sessionId: string) {
    return this.request<unknown[]>(
      'GET',
      `${workspacePath(workspaceId)}/messages?session_id=${encodeURIComponent(sessionId)}`,
    )
  }

  /** Deletes the session and its messages. One already gone is fine. */
  async deleteSession(workspaceId: string, sessionId: string): Promise<void> {
    const path = `${workspacePath(workspaceId)}/sessions/${encodeURIComponent(sessionId)}`
    const res = await this.forward('DELETE', path)
    if (!res.ok && res.status !== 404) {
      throw new NapError(`DELETE ${path} → ${res.status}: ${await res.text()}`, res.status)
    }
  }
}
