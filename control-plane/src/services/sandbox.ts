// NAP Sandbox Service client — calls the sandbox service REST API
// Env: SANDBOX_SERVICE_URL (default: http://nap-sandbox:3006)

const SANDBOX_SERVICE_URL = process.env.SANDBOX_SERVICE_URL || 'http://nap-sandbox:3006'

function buildHeaders(token: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }
}

async function request<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${SANDBOX_SERVICE_URL}${path}`, {
    method,
    headers: buildHeaders(token),
    body: body != null ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`Sandbox service ${method} ${path} failed (${res.status}): ${text}`)
  }
  const ct = res.headers.get('content-type') ?? ''
  if (ct.includes('application/json')) {
    return (await res.json()) as T
  }
  return undefined as T
}

// ---- Types ----

interface SandboxInfo {
  id: string
  status: string
  image?: string
  createdAt?: string
  expiresAt?: string
  metadata?: Record<string, string>
}

interface CommandResult {
  stdout: string
  stderr: string
  exit_code: number | null
  execution_time_ms?: number
  command_id?: string
  background?: boolean
}

interface FileEntry {
  path: string
  type?: string
  size?: number
  modifiedAt?: string
}

// ---- Lifecycle ----

export async function createSandbox(
  token: string,
  opts: {
    image: string
    timeoutSeconds?: number
    resource?: Record<string, string>
    resourceRequests?: Record<string, string>
    entrypoint?: string[]
    env?: Record<string, string>
    metadata?: Record<string, string>
  },
): Promise<SandboxInfo> {
  return request<SandboxInfo>(token, 'POST', '/api/sandboxes', {
    image: opts.image,
    timeoutSeconds: opts.timeoutSeconds ?? 3600,
    resource: opts.resource ?? { cpu: '500m', memory: '512Mi' },
    resourceRequests: opts.resourceRequests,
    entrypoint: opts.entrypoint,
    env: opts.env,
    metadata: opts.metadata,
  })
}

export async function renewSandbox(
  token: string,
  sandboxId: string,
  timeoutSeconds: number,
): Promise<{ expiresAt: string }> {
  return request<{ expiresAt: string }>(token, 'POST', `/api/sandboxes/${sandboxId}/renew`, {
    timeoutSeconds,
  })
}

export async function listSandboxes(
  token: string,
  filter?: { metadata?: Record<string, string> },
): Promise<{ items: SandboxInfo[] }> {
  const params = new URLSearchParams()
  if (filter?.metadata) {
    for (const [k, v] of Object.entries(filter.metadata)) {
      params.set(`metadata.${k}`, v)
    }
  }
  const qs = params.toString()
  return request<{ items: SandboxInfo[] }>(token, 'GET', `/api/sandboxes${qs ? `?${qs}` : ''}`)
}

export async function deleteSandbox(token: string, sandboxId: string): Promise<void> {
  await request<void>(token, 'DELETE', `/api/sandboxes/${sandboxId}`)
}

// ---- Command execution ----

export async function runCommand(
  token: string,
  sandboxId: string,
  command: string,
  opts?: {
    cwd?: string
    timeoutSeconds?: number
    env?: Record<string, string>
    background?: boolean
  },
): Promise<CommandResult> {
  const result = await request<{
    stdout: string
    stderr: string
    exitCode: number | null
    executionTimeMs?: number
    commandId?: string
    background?: boolean
  }>(token, 'POST', `/api/sandboxes/${sandboxId}/exec`, {
    command,
    cwd: opts?.cwd,
    timeoutSeconds: opts?.timeoutSeconds,
    env: opts?.env,
    background: opts?.background,
  })
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exitCode,
    execution_time_ms: result.executionTimeMs,
    command_id: result.commandId,
    background: result.background,
  }
}

export async function getCommandStatus(
  token: string,
  sandboxId: string,
  commandId: string,
): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>(
    token,
    'GET',
    `/api/sandboxes/${sandboxId}/commands/${commandId}`,
  )
}

export async function getCommandLogs(
  token: string,
  sandboxId: string,
  commandId: string,
  cursor?: number,
): Promise<{ content?: string; cursor?: number }> {
  const qs = cursor != null ? `?cursor=${cursor}` : ''
  return request<{ content?: string; cursor?: number }>(
    token,
    'GET',
    `/api/sandboxes/${sandboxId}/commands/${commandId}/logs${qs}`,
  )
}

export async function interruptCommand(
  token: string,
  sandboxId: string,
  commandId: string,
): Promise<void> {
  await request<void>(token, 'POST', `/api/sandboxes/${sandboxId}/commands/${commandId}/interrupt`)
}

// ---- Endpoint ----

export async function getEndpoint(token: string, sandboxId: string, port: number): Promise<string> {
  const result = await request<{ url: string }>(
    token,
    'GET',
    `/api/sandboxes/${sandboxId}/endpoint/${port}`,
  )
  return result.url
}

// ---- File operations ----

export async function readFile(
  token: string,
  sandboxId: string,
  path: string,
  opts?: { offset?: number; limit?: number },
): Promise<string> {
  const params = new URLSearchParams({ path })
  if (opts?.offset != null) params.set('offset', String(opts.offset))
  if (opts?.limit != null) params.set('limit', String(opts.limit))
  const result = await request<{ content: string }>(
    token,
    'GET',
    `/api/sandboxes/${sandboxId}/files?${params.toString()}`,
  )
  return result.content
}

export async function writeFiles(
  token: string,
  sandboxId: string,
  files: Array<{ path: string; data: string }>,
): Promise<void> {
  await request<void>(token, 'POST', `/api/sandboxes/${sandboxId}/files`, {
    files: files.map((f) => ({ path: f.path, content: f.data })),
  })
}

/** Glob search, flat result. See listDirectory for a real directory listing. */
export async function searchFiles(
  token: string,
  sandboxId: string,
  path: string,
  pattern?: string,
): Promise<FileEntry[]> {
  const params = new URLSearchParams({ path })
  if (pattern) params.set('pattern', pattern)
  const result = await request<{ files: FileEntry[] }>(
    token,
    'GET',
    `/api/sandboxes/${sandboxId}/files/list?${params.toString()}`,
  )
  return result.files
}

/** Directory listing; each entry carries a `type` (file / directory / symlink). */
export async function listDirectory(
  token: string,
  sandboxId: string,
  path: string,
  depth?: number,
): Promise<FileEntry[]> {
  const params = new URLSearchParams({ path })
  if (depth != null) params.set('depth', String(depth))
  const result = await request<{ files: FileEntry[] }>(
    token,
    'GET',
    `/api/sandboxes/${sandboxId}/files/dir?${params.toString()}`,
  )
  return result.files
}

export async function deleteFiles(
  token: string,
  sandboxId: string,
  paths: string[],
): Promise<void> {
  await request<void>(token, 'DELETE', `/api/sandboxes/${sandboxId}/files`, { paths })
}

export async function moveFiles(
  token: string,
  sandboxId: string,
  entries: Array<{ src: string; dest: string }>,
): Promise<void> {
  await request<void>(token, 'POST', `/api/sandboxes/${sandboxId}/files/move`, { entries })
}

export async function createDirectories(
  token: string,
  sandboxId: string,
  entries: Array<{ path: string; mode?: number }>,
): Promise<void> {
  await request<void>(token, 'POST', `/api/sandboxes/${sandboxId}/directories`, { entries })
}

export async function deleteDirectories(
  token: string,
  sandboxId: string,
  paths: string[],
): Promise<void> {
  await request<void>(token, 'DELETE', `/api/sandboxes/${sandboxId}/directories`, { paths })
}

export async function replaceContents(
  token: string,
  sandboxId: string,
  entries: Array<{ path: string; oldContent: string; newContent: string }>,
): Promise<{
  results: Array<{ path: string; replacedCount: number }>
  detailAvailable: boolean
}> {
  return request<{
    results: Array<{ path: string; replacedCount: number }>
    detailAvailable: boolean
  }>(token, 'POST', `/api/sandboxes/${sandboxId}/files/replace`, { entries })
}
