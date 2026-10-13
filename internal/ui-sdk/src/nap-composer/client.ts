// Data contract between the platform composer preset and whatever reaches the
// platform API — the platform's own web app, or a third-party backend that
// proxies a pinned workspace.

/** A workspace slash command as the platform lists it. */
export interface NapWorkspaceCommand {
  name: string
  type: 'plain' | 'struct'
  content: string
  /** Set when the command is backed by a prompt-library entry. */
  prompt_id?: string | null
  /** Resolved prompt-library text; takes precedence over `content` when present. */
  prompt_content?: string | null
  /** Template command the user turned off: listed for management, never offered. */
  disabled?: boolean
}

/** An agent (workspace) the current user may address with `@agent/…`. */
export interface NapCallableAgent {
  id: string
  slug: string
  name: string
  owner: string
  /** True for the user's own agents, addressed by bare slug; others use `owner/slug`. */
  is_own: boolean
}

/** One entry of a workspace directory listing. */
export interface NapDirEntry {
  name: string
  path_type: 'Dir' | 'File' | 'SymLink' | 'SymlinkDir'
}

export interface NapTranscribeOptions {
  /** BCP-47 language hint for the speech recognizer. */
  language?: string
  /** Free-text context (names, jargon) that biases recognition. */
  hint?: string
}

/**
 * What the preset needs from the platform. Every method is optional: a source
 * whose method is missing is simply left out, so an app can implement only
 * what it exposes.
 */
export interface NapComposerClient {
  /** The workspace's slash commands (`GET /workspaces/:id/commands`). */
  listCommands?: () => Promise<NapWorkspaceCommand[]>
  /** Agents the user can call (`GET /workspaces/callable`). */
  listCallableAgents?: () => Promise<NapCallableAgent[]>
  /**
   * Entries under a workspace directory (`GET /workspaces/:id/agent/dirs`).
   * `dir` is workspace-relative without a leading slash (`''` is the root). A
   * non-empty `query` asks for a recursive name search within `dir`.
   */
  listDir?: (dir: string, query: string, signal?: AbortSignal) => Promise<NapDirEntry[]>
  /** Speech to text (`POST /asr/transcribe`). Reject with a user-facing message (empty falls back to a generic one). */
  transcribe?: (audio: Blob, options?: NapTranscribeOptions) => Promise<string>
}

export interface NapHttpClientOptions {
  /** API root, e.g. `/api` on the platform or your proxy's prefix. */
  baseUrl: string
  /** Workspace the commands and files belong to. */
  workspaceId: string
  /** Extra request headers (e.g. `Authorization`), static or per request. */
  headers?: HeadersInit | (() => HeadersInit)
  /** Defaults to `same-origin`. */
  credentials?: RequestCredentials
  /** Defaults to the global `fetch`. */
  fetch?: typeof fetch
}

/** The server's `{ error }` text, or '' so callers can substitute a localized fallback. */
async function errorMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null
  return typeof body?.error === 'string' ? body.error : ''
}

/**
 * {@link NapComposerClient} over the platform's REST paths. Point `baseUrl` at
 * the platform API, or at a backend that exposes the same four paths.
 */
export function createNapHttpClient(options: NapHttpClientOptions): NapComposerClient {
  const base = options.baseUrl.replace(/\/+$/, '')
  const ws = encodeURIComponent(options.workspaceId)
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init))
  const request = async (path: string, init?: RequestInit): Promise<Response> => {
    const headers =
      typeof options.headers === 'function' ? options.headers() : (options.headers ?? {})
    const res = await doFetch(`${base}${path}`, {
      ...init,
      headers,
      credentials: options.credentials ?? 'same-origin',
    })
    if (!res.ok) throw new Error(await errorMessage(res))
    return res
  }

  return {
    listCommands: async () => {
      const res = await request(`/workspaces/${ws}/commands`)
      return ((await res.json()) as { commands: NapWorkspaceCommand[] }).commands
    },
    listCallableAgents: async () => {
      const res = await request('/workspaces/callable')
      return (await res.json()) as NapCallableAgent[]
    },
    listDir: async (dir, query, signal) => {
      const params = new URLSearchParams({ path: dir.replace(/^\/+/, '') })
      if (query) params.set('q', query)
      const res = await request(`/workspaces/${ws}/agent/dirs?${params}`, { signal })
      return ((await res.json()) as { entries?: NapDirEntry[] }).entries ?? []
    },
    transcribe: async (audio, opts) => {
      const form = new FormData()
      form.append('audio', audio, 'audio.webm')
      if (opts?.language) form.append('language', opts.language)
      if (opts?.hint) form.append('hint', opts.hint)
      const res = await request('/asr/transcribe', { method: 'POST', body: form })
      return ((await res.json()) as { text?: string }).text ?? ''
    },
  }
}
