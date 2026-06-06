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
}

// ---- Lifecycle ----

export async function createSandbox(
  token: string,
  opts: {
    image: string
    timeoutSeconds?: number
    resource?: Record<string, string>
    entrypoint?: string[]
    env?: Record<string, string>
    metadata?: Record<string, string>
  },
): Promise<SandboxInfo> {
  return request<SandboxInfo>(token, 'POST', '/api/sandboxes', {
    image: opts.image,
    timeoutSeconds: opts.timeoutSeconds ?? 3600,
    resource: opts.resource ?? { cpu: '500m', memory: '512Mi' },
    entrypoint: opts.entrypoint,
    env: opts.env,
    metadata: opts.metadata,
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
  },
): Promise<CommandResult> {
  const result = await request<{
    stdout: string
    stderr: string
    exitCode: number | null
    executionTimeMs?: number
  }>(token, 'POST', `/api/sandboxes/${sandboxId}/exec`, {
    command,
    cwd: opts?.cwd,
    timeoutSeconds: opts?.timeoutSeconds,
    env: opts?.env,
  })
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exitCode,
    execution_time_ms: result.executionTimeMs,
  }
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

export async function readFile(token: string, sandboxId: string, path: string): Promise<string> {
  const result = await request<{ content: string }>(
    token,
    'GET',
    `/api/sandboxes/${sandboxId}/files?path=${encodeURIComponent(path)}`,
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
