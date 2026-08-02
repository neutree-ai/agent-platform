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

// ---- Resource requests ----

// Requests default to the limits, so an idle sandbox holds its full limit
// against node capacity for as long as it lives. Measured over 7 days across
// the running sandboxes, memory peaks at 7% of the limit at the median and 30%
// at p95, while the sandbox nodes were sitting at 45-92% reserved.
//
// Memory only, for now. CPU requests also set the CFS weight, so cutting them
// makes a busy sandbox lose ground under contention, and the CPU tail is real
// (p95 peaks at 99% of its limit) — that one wants its own rollout.
const MEMORY_REQUEST_RATIO = 0.4
const MEMORY_REQUEST_FLOOR_MIB = 256

const MEMORY_UNITS: Record<string, number> = {
  Ki: 1 / 1024,
  Mi: 1,
  Gi: 1024,
  Ti: 1024 * 1024,
  K: 1000 / 1024 / 1024,
  M: (1000 * 1000) / 1024 / 1024,
  G: (1000 * 1000 * 1000) / 1024 / 1024,
}

/** Parse a Kubernetes memory quantity into MiB; null if it isn't one. */
function parseMemoryMiB(value: string): number | null {
  const m = /^(\d+(?:\.\d+)?)([KMGT]i?)?$/.exec(value.trim())
  if (!m) return null
  const amount = Number.parseFloat(m[1])
  if (!Number.isFinite(amount)) return null
  const unit = m[2]
  if (!unit) return amount / 1024 / 1024 // plain bytes
  const factor = MEMORY_UNITS[unit]
  return factor === undefined ? null : amount * factor
}

/**
 * Derive the resource requests for a sandbox whose caller did not specify any.
 * Returns undefined when there is nothing to derive, which leaves the runtime
 * on its own default of requests == limits.
 */
function deriveResourceRequests(
  resource: Record<string, string>,
): Record<string, string> | undefined {
  const limit = resource.memory
  if (!limit) return undefined
  const limitMiB = parseMemoryMiB(limit)
  if (limitMiB === null) return undefined
  const requestMiB = Math.min(
    limitMiB,
    Math.max(MEMORY_REQUEST_FLOOR_MIB, Math.round(limitMiB * MEMORY_REQUEST_RATIO)),
  )
  // Omitting cpu leaves the CPU request defaulting to the CPU limit.
  return { memory: `${Math.round(requestMiB)}Mi` }
}

// ---- Lifecycle ----

export async function createSandbox(opts: {
  image: string
  timeoutSeconds?: number
  resource?: Record<string, string>
  // Kubernetes resource *requests*, set independently of `resource` (which maps
  // to limits). Left unset, a memory request is derived from the memory limit —
  // see deriveResourceRequests. Pass a value to override that, including the
  // limits themselves to opt back into Guaranteed QoS.
  // Honoured by opensandbox-server >= v0.2.1; older servers ignore it and leave
  // requests equal to limits.
  resourceRequests?: Record<string, string>
  entrypoint?: string[]
  env?: Record<string, string>
  metadata?: Record<string, string>
}): Promise<SandboxInfo> {
  const resource = opts.resource ?? { cpu: '500m', memory: '512Mi' }
  const sbx = await Sandbox.create({
    connectionConfig: getConnectionConfig(),
    image: opts.image,
    timeoutSeconds: opts.timeoutSeconds ?? 3600,
    resource,
    resourceRequests: opts.resourceRequests ?? deriveResourceRequests(resource),
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
  // Present when the command was started with `background: true`. Feed it to
  // getCommandStatus / getBackgroundCommandLogs to follow the run.
  commandId?: string
  background?: boolean
}

export async function runCommand(
  sandboxId: string,
  command: string,
  opts?: {
    cwd?: string
    timeoutSeconds?: number
    env?: Record<string, string>
    // Detach instead of blocking until exit. stdout/stderr come back empty —
    // the command is still starting — so callers poll with the returned
    // commandId. Replaces the `nohup cmd &` workaround.
    background?: boolean
  },
): Promise<CommandResult> {
  const sbx = await connectSandbox(sandboxId)
  try {
    const execution = await sbx.commands.run(command, {
      workingDirectory: opts?.cwd,
      timeoutSeconds: opts?.timeoutSeconds,
      envs: opts?.env,
      background: opts?.background,
    })
    return {
      stdout: execution.logs.stdout.map((m) => m.text).join('\n'),
      stderr: execution.logs.stderr.map((m) => m.text).join('\n'),
      exitCode: execution.exitCode ?? null,
      executionTimeMs: execution.complete?.executionTimeMs,
      commandId: execution.id,
      background: opts?.background || undefined,
    }
  } finally {
    await sbx.close()
  }
}

export async function getCommandStatus(
  sandboxId: string,
  commandId: string,
): Promise<Record<string, unknown>> {
  const sbx = await connectSandbox(sandboxId)
  try {
    return (await sbx.commands.getCommandStatus(commandId)) as unknown as Record<string, unknown>
  } finally {
    await sbx.close()
  }
}

/**
 * Fetch a chunk of a background command's output. `cursor` is the byte offset
 * returned by the previous call — pass it back to continue where you left off
 * instead of re-reading the whole log.
 */
export async function getBackgroundCommandLogs(
  sandboxId: string,
  commandId: string,
  cursor?: number,
): Promise<Record<string, unknown>> {
  const sbx = await connectSandbox(sandboxId)
  try {
    return (await sbx.commands.getBackgroundCommandLogs(commandId, cursor)) as unknown as Record<
      string,
      unknown
    >
  } finally {
    await sbx.close()
  }
}

/**
 * Terminate a running command.
 *
 * The SDK types name the argument `sessionId`, but execd accepts a background
 * command id here too — verified against opensandbox-server v0.2.2, where the
 * command lands on `running: false, exitCode: -1, error: "signal: terminate…"`.
 */
export async function interruptCommand(sandboxId: string, commandId: string): Promise<void> {
  const sbx = await connectSandbox(sandboxId)
  try {
    await sbx.commands.interrupt(commandId)
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

/** Take lines [offset, offset+limit) from `text`; offset is 1-based. */
function sliceLines(text: string, offset?: number, limit?: number): string {
  const lines = text.split('\n')
  // A trailing newline yields a final empty element that is not a line.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  const start = Math.max(0, (offset ?? 1) - 1)
  const end = limit != null ? start + limit : lines.length
  return lines.slice(start, end).join('\n')
}

/**
 * Read a text file. `offset`/`limit` select a line range (offset is 1-based) so
 * callers can page through a large file instead of pulling all of it — a full
 * read is easy to truncate downstream once it crosses a tool-output limit.
 *
 * Line ranges are an execd-side feature. Older execd (v1.0.16, what production
 * currently runs) ignores the parameters and returns the whole file with no
 * error, which would hand the caller far more than it asked for while looking
 * like a successful paged read.
 *
 * So the range is always applied here, and the request to execd asks for the
 * leading `offset + limit - 1` lines rather than the range itself. That prefix
 * is the same shape whether execd honours it or returns everything, so slicing
 * it locally lands on the right lines either way and needs no version check.
 * The cost is pulling the lines before `offset` on a capable execd; bounded,
 * and only noticeable when paging deep into a file.
 */
export async function readFile(
  sandboxId: string,
  path: string,
  opts?: { offset?: number; limit?: number },
): Promise<string> {
  const ranged = opts?.offset !== undefined || opts?.limit !== undefined
  const sbx = await connectSandbox(sandboxId)
  try {
    if (!ranged) return await sbx.files.readFile(path)
    const offset = opts?.offset ?? 1
    const prefixLimit = opts?.limit != null ? offset + opts.limit - 1 : undefined
    const content = await sbx.files.readFile(
      path,
      prefixLimit != null ? { offset: 1, limit: prefixLimit } : undefined,
    )
    return sliceLines(content, offset, opts?.limit)
  } finally {
    await sbx.close()
  }
}

/**
 * Search for files by glob pattern. Returns a flat list.
 *
 * Kept separate from listDirectory: browser-service uses this to find a
 * downloaded file by name under /downloads, which is a search, not a listing.
 */
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

/**
 * List a directory's entries, each carrying a `type` (file/directory/symlink).
 * `depth` defaults to 1 (immediate children); symlinks are reported as
 * symlinks and are not followed.
 *
 * Note: `type` is populated by the server, not the SDK — against an older
 * opensandbox-server the field comes back empty.
 */
export async function listDirectory(
  sandboxId: string,
  path: string,
  depth?: number,
): Promise<FileInfo[]> {
  const sbx = await connectSandbox(sandboxId)
  try {
    return await sbx.files.listDirectory({ path, depth })
  } catch (e: any) {
    // execd v1.0.16 has no directory endpoint and fails with a bare
    // "List directory failed". Say why, so this doesn't read as a bad path.
    throw new Error(
      `${e?.message ?? e} (directory listing needs execd >= v1.0.20; use the glob search endpoint on older sandboxes)`,
    )
  } finally {
    await sbx.close()
  }
}

export async function deleteFiles(sandboxId: string, paths: string[]): Promise<void> {
  const sbx = await connectSandbox(sandboxId)
  try {
    await sbx.files.deleteFiles(paths)
  } finally {
    await sbx.close()
  }
}

export async function moveFiles(
  sandboxId: string,
  entries: Array<{ src: string; dest: string }>,
): Promise<void> {
  const sbx = await connectSandbox(sandboxId)
  try {
    await sbx.files.moveFiles(entries)
  } finally {
    await sbx.close()
  }
}

export async function createDirectories(
  sandboxId: string,
  entries: Array<{ path: string; mode?: number }>,
): Promise<void> {
  const sbx = await connectSandbox(sandboxId)
  try {
    await sbx.files.createDirectories(entries)
  } finally {
    await sbx.close()
  }
}

export async function deleteDirectories(sandboxId: string, paths: string[]): Promise<void> {
  const sbx = await connectSandbox(sandboxId)
  try {
    await sbx.files.deleteDirectories(paths)
  } finally {
    await sbx.close()
  }
}

/**
 * Replace text in files. Returns a per-file `replacedCount` so callers can tell
 * "no match" (0) from "changed" — a plain replace call can't.
 *
 * The counts come from execd and older builds (v1.0.16) return an empty list
 * while still performing the replacement. `detailAvailable: false` marks that
 * case, so an empty `results` is not mistaken for "nothing was replaced".
 */
export async function replaceContents(
  sandboxId: string,
  entries: Array<{ path: string; oldContent: string; newContent: string }>,
): Promise<{
  results: Array<{ path: string; replacedCount: number }>
  detailAvailable: boolean
}> {
  const sbx = await connectSandbox(sandboxId)
  try {
    const results = await sbx.files.replaceContentsDetailed(entries)
    return {
      results,
      detailAvailable: !(entries.length > 0 && results.length === 0),
    }
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
