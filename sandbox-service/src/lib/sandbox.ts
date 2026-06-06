// OpenSandbox SDK wrapper — internal only, not exposed to external users.

import {
  ConnectionConfig,
  type FileInfo,
  type ListSandboxesResponse,
  Sandbox,
  type SandboxInfo,
  SandboxManager,
} from '@alibaba-group/opensandbox'

const OPENSANDBOX_URL = process.env.OPENSANDBOX_URL || 'http://opensandbox-server.default.svc'

function getConnectionConfig() {
  return new ConnectionConfig({
    domain: OPENSANDBOX_URL,
    useServerProxy: true,
  })
}

let _manager: SandboxManager | null = null
function getManager(): SandboxManager {
  if (!_manager) {
    _manager = SandboxManager.create({
      connectionConfig: getConnectionConfig(),
    })
  }
  return _manager
}

async function connectSandbox(sandboxId: string): Promise<Sandbox> {
  return Sandbox.connect({
    connectionConfig: getConnectionConfig(),
    sandboxId,
    skipHealthCheck: true,
  })
}

// ---- Lifecycle ----

export async function createSandbox(opts: {
  image: string
  timeoutSeconds?: number
  resource?: Record<string, string>
  entrypoint?: string[]
  env?: Record<string, string>
  metadata?: Record<string, string>
}): Promise<SandboxInfo> {
  const sbx = await Sandbox.create({
    connectionConfig: getConnectionConfig(),
    image: opts.image,
    timeoutSeconds: opts.timeoutSeconds ?? 3600,
    resource: opts.resource ?? { cpu: '500m', memory: '512Mi' },
    entrypoint: opts.entrypoint,
    env: opts.env,
    metadata: opts.metadata,
    skipHealthCheck: true,
  })
  const info = await sbx.getInfo()
  await sbx.close()
  return info
}

export async function listSandboxes(filter?: {
  metadata?: Record<string, string>
}): Promise<ListSandboxesResponse> {
  return getManager().listSandboxInfos({
    metadata: filter?.metadata,
  })
}

export async function getSandbox(sandboxId: string): Promise<SandboxInfo> {
  return getManager().getSandboxInfo(sandboxId)
}

export async function deleteSandbox(sandboxId: string): Promise<void> {
  return getManager().killSandbox(sandboxId)
}

export async function renewSandbox(
  sandboxId: string,
  timeoutSeconds: number,
): Promise<{ expiresAt: string }> {
  const sbx = await connectSandbox(sandboxId)
  try {
    const result = await sbx.renew(timeoutSeconds)
    return {
      expiresAt:
        result.expiresAt instanceof Date
          ? result.expiresAt.toISOString()
          : (result.expiresAt ?? ''),
    }
  } finally {
    await sbx.close()
  }
}

// ---- Command execution ----

interface CommandResult {
  stdout: string
  stderr: string
  exitCode: number | null
  executionTimeMs?: number
}

export async function runCommand(
  sandboxId: string,
  command: string,
  opts?: {
    cwd?: string
    timeoutSeconds?: number
    env?: Record<string, string>
  },
): Promise<CommandResult> {
  const sbx = await connectSandbox(sandboxId)
  try {
    const execution = await sbx.commands.run(command, {
      workingDirectory: opts?.cwd,
      timeoutSeconds: opts?.timeoutSeconds,
      envs: opts?.env,
    })
    return {
      stdout: execution.logs.stdout.map((m) => m.text).join('\n'),
      stderr: execution.logs.stderr.map((m) => m.text).join('\n'),
      exitCode: execution.exitCode ?? null,
      executionTimeMs: execution.complete?.executionTimeMs,
    }
  } finally {
    await sbx.close()
  }
}

// ---- Endpoint ----

export async function getEndpoint(sandboxId: string, port: number): Promise<string> {
  const sbx = await connectSandbox(sandboxId)
  try {
    return await sbx.getEndpointUrl(port)
  } finally {
    await sbx.close()
  }
}

// Direct (non-server-proxy) endpoint: resolves to the sandbox pod's in-cluster
// address (e.g. http://172.16.x.x:5173) instead of routing through the
// opensandbox-server proxy. The server proxy reserves the `Authorization`
// header for its own API auth and strips it before forwarding to the app — so
// any preview app relying on a Bearer token never receives it. Resolving a
// direct address keeps request/response headers intact. sandbox-service runs
// in-cluster, so it can reach pod IPs directly. Used by the public preview proxy.
export async function getEndpointDirect(sandboxId: string, port: number): Promise<string> {
  const sbx = await connectSandbox(sandboxId)
  try {
    const ep = await sbx.sandboxes.getSandboxEndpoint(sbx.id, port, false)
    return `http://${ep.endpoint}`
  } finally {
    await sbx.close()
  }
}

// ---- File operations ----

export async function readFile(sandboxId: string, path: string): Promise<string> {
  const sbx = await connectSandbox(sandboxId)
  try {
    return await sbx.files.readFile(path)
  } finally {
    await sbx.close()
  }
}

export async function listFiles(
  sandboxId: string,
  path: string,
  pattern?: string,
): Promise<FileInfo[]> {
  const sbx = await connectSandbox(sandboxId)
  try {
    return await sbx.files.search({ path, pattern })
  } finally {
    await sbx.close()
  }
}

export async function statFile(sandboxId: string, path: string): Promise<FileInfo | null> {
  const sbx = await connectSandbox(sandboxId)
  try {
    const info = await sbx.files.getFileInfo([path])
    return info[path] ?? null
  } finally {
    await sbx.close()
  }
}

/**
 * Stream a file's bytes. The returned object exposes the underlying sandbox
 * connection — the caller MUST call `close()` when the stream is done so the
 * SDK connection is released.
 */
export async function readFileStream(
  sandboxId: string,
  path: string,
  range?: string,
): Promise<{
  stream: AsyncIterable<Uint8Array>
  close: () => Promise<void>
}> {
  const sbx = await connectSandbox(sandboxId)
  try {
    const stream = sbx.files.readBytesStream(path, range ? { range } : undefined)
    return {
      stream,
      close: () => sbx.close(),
    }
  } catch (e) {
    await sbx.close()
    throw e
  }
}

export async function writeFiles(
  sandboxId: string,
  files: Array<{ path: string; data: string }>,
): Promise<void> {
  const sbx = await connectSandbox(sandboxId)
  try {
    await sbx.files.writeFiles(files.map((f) => ({ path: f.path, data: f.data })))
  } finally {
    await sbx.close()
  }
}
