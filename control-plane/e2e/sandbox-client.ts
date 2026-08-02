import { profile } from './setup'

// Minimal client for the deployed sandbox service.
//
// The control plane proxies only create/list/endpoint/delete, so the file and
// command surface has no route through it and these specs call the component
// directly. Deliberately hand-rolled and narrow: this covers what the specs
// assert, and a shared SDK would let a passing suite depend on a client that
// the deployed service does not actually agree with.

interface FileEntry {
  path: string
  type?: string
  size?: number
}

interface CommandResult {
  stdout: string
  stderr: string
  exitCode: number | null
  executionTimeMs?: number
  commandId?: string
  background?: boolean
}

interface CommandStatus {
  id: string
  running: boolean
  exitCode: number | null
  error?: string
}

interface CommandLogs {
  content?: string
  cursor?: number
}

class SandboxServiceError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    body: string,
  ) {
    super(`sandbox-service ${method} ${path} → ${status}: ${body}`)
  }
}

function baseUrl(): string {
  const url = profile.sandboxServiceUrl
  if (!url) throw new Error('sandboxServiceUrl is not configured for this run')
  return url
}

async function requestTo<T>(
  origin: string,
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${origin}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body != null ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120_000),
  })
  if (!res.ok) {
    throw new SandboxServiceError(res.status, method, path, await res.text().catch(() => ''))
  }
  const ct = res.headers.get('content-type') ?? ''
  return (ct.includes('application/json') ? await res.json() : undefined) as T
}

const request = <T>(token: string, method: string, path: string, body?: unknown) =>
  requestTo<T>(baseUrl(), token, method, path, body)

/**
 * The four sandbox operations the control plane proxies, scoped to a workspace.
 * Separate from the component's own surface below because they prove a
 * different thing: that a workspace can own a sandbox at all.
 */
export function workspaceSandboxes(token: string, workspaceId: string) {
  const cp = <T>(method: string, path: string, body?: unknown) =>
    requestTo<T>(profile.baseUrl, token, method, path, body)

  return {
    create: (body: {
      image: string
      resource?: Record<string, string>
      timeout_seconds?: number
    }) => cp<{ id: string }>('POST', `/api/workspaces/${workspaceId}/sandboxes`, body),
    list: () => cp<{ sandboxes?: unknown[] }>('GET', `/api/workspaces/${workspaceId}/sandboxes`),
    endpoint: (sandboxId: string, port: number) =>
      cp<{ url: string }>(
        'GET',
        `/api/workspaces/${workspaceId}/sandboxes/${sandboxId}/endpoint/${port}`,
      ),
    delete: (sandboxId: string) =>
      cp<void>('DELETE', `/api/workspaces/${workspaceId}/sandboxes/${sandboxId}`),
  }
}

export function sandboxService(token: string) {
  const q = (params: Record<string, string | number | undefined>) => {
    const sp = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) sp.set(k, String(v))
    }
    const s = sp.toString()
    return s ? `?${s}` : ''
  }

  return {
    create: (body: {
      image: string
      timeoutSeconds?: number
      resource?: Record<string, string>
      resourceRequests?: Record<string, string>
      metadata?: Record<string, string>
    }) => request<{ id: string }>(token, 'POST', '/api/sandboxes', body),

    kill: (id: string) => request<void>(token, 'DELETE', `/api/sandboxes/${id}`),

    exec: (
      id: string,
      command: string,
      opts?: { cwd?: string; timeoutSeconds?: number; background?: boolean },
    ) => request<CommandResult>(token, 'POST', `/api/sandboxes/${id}/exec`, { command, ...opts }),

    commandStatus: (id: string, commandId: string) =>
      request<CommandStatus>(token, 'GET', `/api/sandboxes/${id}/commands/${commandId}`),

    commandLogs: (id: string, commandId: string, cursor?: number) =>
      request<CommandLogs>(
        token,
        'GET',
        `/api/sandboxes/${id}/commands/${commandId}/logs${q({ cursor })}`,
      ),

    interruptCommand: (id: string, commandId: string) =>
      request<{ success: true }>(
        token,
        'POST',
        `/api/sandboxes/${id}/commands/${commandId}/interrupt`,
      ),

    writeFiles: (id: string, files: Array<{ path: string; content: string }>) =>
      request<{ success: true; count: number }>(token, 'POST', `/api/sandboxes/${id}/files`, {
        files,
      }),

    readFile: (id: string, path: string, opts?: { offset?: number; limit?: number }) =>
      request<{ content: string }>(
        token,
        'GET',
        `/api/sandboxes/${id}/files${q({ path, ...opts })}`,
      ),

    listDirectory: (id: string, path: string, depth?: number) =>
      request<{ files: FileEntry[] }>(
        token,
        'GET',
        `/api/sandboxes/${id}/files/dir${q({ path, depth })}`,
      ),

    searchFiles: (id: string, path: string, pattern?: string) =>
      request<{ files: FileEntry[] }>(
        token,
        'GET',
        `/api/sandboxes/${id}/files/list${q({ path, pattern })}`,
      ),

    replaceContents: (
      id: string,
      entries: Array<{ path: string; oldContent: string; newContent: string }>,
    ) =>
      request<{
        results: Array<{ path: string; replacedCount: number }>
        detailAvailable: boolean
      }>(token, 'POST', `/api/sandboxes/${id}/files/replace`, { entries }),

    moveFiles: (id: string, entries: Array<{ src: string; dest: string }>) =>
      request<{ success: true; count: number }>(token, 'POST', `/api/sandboxes/${id}/files/move`, {
        entries,
      }),

    deleteFiles: (id: string, paths: string[]) =>
      request<{ success: true; count: number }>(token, 'DELETE', `/api/sandboxes/${id}/files`, {
        paths,
      }),

    createDirectories: (id: string, entries: Array<{ path: string }>) =>
      request<{ success: true; count: number }>(token, 'POST', `/api/sandboxes/${id}/directories`, {
        entries,
      }),

    deleteDirectories: (id: string, paths: string[]) =>
      request<{ success: true; count: number }>(
        token,
        'DELETE',
        `/api/sandboxes/${id}/directories`,
        { paths },
      ),
  }
}
