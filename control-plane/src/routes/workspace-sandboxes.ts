import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { Context } from 'hono'
import {
  SandboxNotFoundError,
  type SandboxProvider,
  unsupportedCreateOptions,
} from 'neu-sandbox-mcp'
import type { AppEnv } from '../lib/types'
import { canAccessWorkspace } from '../lib/workspace-access'
import { getWorkspace } from '../services/db/workspaces'
import { workspaceSandboxes as sandboxesOf } from '../services/sandbox-provider'

// Every route acts through the workspace's scoped provider: it tags what it
// creates with the workspace, and reports any other sandbox as not found. With
// the platform's own sandbox service it runs as the workspace owner, even on
// cookie-authenticated UI requests, so the service sees the real user.

const workspaceSandboxes = new OpenAPIHono<AppEnv>()

/** The workspace's sandboxes, or null when the caller cannot see the workspace. */
async function sandboxesFor(
  c: Context<AppEnv>,
  workspaceId: string,
): Promise<SandboxProvider | null> {
  const workspace = await getWorkspace(workspaceId)
  if (!workspace || !(await canAccessWorkspace(workspace, c.get('user')))) return null
  return sandboxesOf(workspace)
}

const WORKSPACE_NOT_FOUND = { error: 'Workspace not found' }

/**
 * The error body and status for a failed sandbox call: a sandbox outside the
 * workspace is not found, anything else is a server error.
 */
function failure(e: unknown, action: string): { body: { error: string }; status: 404 | 500 } {
  if (e instanceof SandboxNotFoundError) {
    return { body: { error: 'Sandbox not found' }, status: 404 }
  }
  console.error(`[sandbox] ${action} failed:`, e)
  return { body: { error: e instanceof Error ? e.message : String(e) }, status: 500 }
}

const ErrorSchema = z.object({ error: z.string() })
const SuccessSchema = z.object({ success: z.boolean() })

const SandboxInfoSchema = z
  .object({
    id: z.string(),
    status: z
      .enum(['creating', 'running', 'paused', 'stopped', 'failed', 'unknown'])
      .openapi({ example: 'running' }),
    image: z.string().nullable(),
    createdAt: z.string().nullable(),
    expiresAt: z.string().nullable(),
    metadata: z.record(z.string(), z.string()),
  })
  .openapi('WorkspaceSandbox')

const WorkspaceIdParam = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' } }),
})

const SandboxParam = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' } }),
  sandboxId: z.string().openapi({ param: { name: 'sandboxId', in: 'path' } }),
})

const notFound = {
  description: 'Workspace not found',
  content: { 'application/json': { schema: ErrorSchema } },
}
const sandboxNotFound = {
  description: 'Workspace or sandbox not found',
  content: { 'application/json': { schema: ErrorSchema } },
}
const badRequest = {
  description: 'Not supported by the sandbox backend, or invalid input',
  content: { 'application/json': { schema: ErrorSchema } },
}
const serverError = {
  description: 'Sandbox service error',
  content: { 'application/json': { schema: ErrorSchema } },
}

// ── POST /:id/sandboxes ────────────────────────────────────────────────────
const createRouteDef = createRoute({
  method: 'post',
  path: '/{id}/sandboxes',
  tags: ['workspaces'],
  summary: 'Create a sandbox for a workspace. It runs as the workspace owner.',
  security: [{ bearerAuth: [] }],
  request: {
    params: WorkspaceIdParam,
    body: {
      content: {
        'application/json': {
          schema: z.object({
            image: z.string().openapi({ example: 'node:22-bookworm' }),
            resource: z.record(z.string(), z.string()).optional().openapi({
              description: 'Resource limits, e.g. { "cpu": "2", "memory": "4Gi" }',
            }),
            timeout_seconds: z.number().int().positive().optional().openapi({
              description: 'Lifetime in seconds from now (default 3600)',
            }),
            env: z.record(z.string(), z.string()).optional(),
            entrypoint: z
              .array(z.string())
              .optional()
              .openapi({
                description:
                  "Command to run instead of the image's own entrypoint. Rejected by sandbox backends that cannot override it.",
                example: ['npm', 'run', 'start'],
              }),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Created sandbox',
      content: { 'application/json': { schema: SandboxInfoSchema } },
    },
    400: badRequest,
    404: notFound,
    500: serverError,
  },
})

workspaceSandboxes.openapi(createRouteDef, async (c) => {
  const { id } = c.req.valid('param')
  const sandboxes = await sandboxesFor(c, id)
  if (!sandboxes) return c.json(WORKSPACE_NOT_FOUND, 404)

  try {
    const body = c.req.valid('json')
    const opts = {
      image: body.image,
      resource: body.resource,
      timeoutSeconds: body.timeout_seconds,
      env: body.env,
      entrypoint: body.entrypoint,
    }
    const unsupported = unsupportedCreateOptions(sandboxes.capabilities, opts)
    if (unsupported.length > 0) {
      return c.json(
        { error: `This sandbox backend does not support: ${unsupported.join(', ')}` },
        400,
      )
    }
    return c.json(await sandboxes.create(opts), 201)
  } catch (e) {
    const { body, status } = failure(e, 'create')
    return c.json(body, status)
  }
})

// ── GET /:id/sandboxes ─────────────────────────────────────────────────────
const listRoute = createRoute({
  method: 'get',
  path: '/{id}/sandboxes',
  tags: ['workspaces'],
  summary: 'List the sandboxes created for a workspace',
  security: [{ bearerAuth: [] }],
  request: { params: WorkspaceIdParam },
  responses: {
    200: {
      description: 'Sandboxes',
      content: {
        'application/json': { schema: z.object({ items: z.array(SandboxInfoSchema) }) },
      },
    },
    404: notFound,
    500: serverError,
  },
})

workspaceSandboxes.openapi(listRoute, async (c) => {
  const { id } = c.req.valid('param')
  const sandboxes = await sandboxesFor(c, id)
  if (!sandboxes) return c.json(WORKSPACE_NOT_FOUND, 404)

  try {
    return c.json({ items: await sandboxes.list() }, 200)
  } catch (e) {
    const { body, status } = failure(e, 'list')
    return c.json(body, status)
  }
})

// ── POST /:id/sandboxes/:sandboxId/renew ───────────────────────────────────
const renewRoute = createRoute({
  method: 'post',
  path: '/{id}/sandboxes/{sandboxId}/renew',
  tags: ['workspaces'],
  summary:
    'Extend a sandbox expiry: adds extend_seconds to the current expiry, or to now if the sandbox has already expired.',
  security: [{ bearerAuth: [] }],
  request: {
    params: SandboxParam,
    body: {
      required: false,
      content: {
        'application/json': {
          schema: z.object({
            extend_seconds: z.number().int().positive().optional().openapi({
              description: 'Seconds to add (default 3600)',
              example: 3600,
            }),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'New expiry',
      content: {
        'application/json': {
          schema: z.object({ sandbox_id: z.string(), expires_at: z.string() }),
        },
      },
    },
    400: badRequest,
    404: sandboxNotFound,
    500: serverError,
  },
})

workspaceSandboxes.openapi(renewRoute, async (c) => {
  const { id, sandboxId } = c.req.valid('param')
  const sandboxes = await sandboxesFor(c, id)
  if (!sandboxes) return c.json(WORKSPACE_NOT_FOUND, 404)

  try {
    const body = c.req.valid('json') ?? {}
    if (!sandboxes.renew) {
      return c.json({ error: 'This sandbox backend cannot renew sandboxes' }, 400)
    }
    const result = await sandboxes.renew(sandboxId, body.extend_seconds ?? 3600)
    return c.json({ sandbox_id: sandboxId, expires_at: result.expiresAt }, 200)
  } catch (e) {
    const { body, status } = failure(e, 'renew')
    return c.json(body, status)
  }
})

// ── GET /:id/sandboxes/:sandboxId/endpoint/:port ───────────────────────────
const endpointRoute = createRoute({
  method: 'get',
  path: '/{id}/sandboxes/{sandboxId}/endpoint/{port}',
  tags: ['workspaces'],
  summary:
    'Get the preview URL of a port inside a sandbox. When `headers` is present, requests to the URL must carry them; when `expires_at` is present, the URL stops working then.',
  security: [{ bearerAuth: [] }],
  request: {
    params: SandboxParam.extend({
      port: z.string().openapi({ param: { name: 'port', in: 'path' }, example: '3000' }),
    }),
  },
  responses: {
    200: {
      description: 'Endpoint URL',
      content: {
        'application/json': {
          schema: z.object({
            sandbox_id: z.string(),
            port: z.number(),
            url: z.string(),
            headers: z.record(z.string(), z.string()).optional(),
            expires_at: z.string().optional(),
          }),
        },
      },
    },
    400: {
      description: 'Invalid port number, or the sandbox backend offers no previews',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: sandboxNotFound,
    500: serverError,
  },
})

workspaceSandboxes.openapi(endpointRoute, async (c) => {
  const { id, sandboxId } = c.req.valid('param')
  const sandboxes = await sandboxesFor(c, id)
  if (!sandboxes) return c.json(WORKSPACE_NOT_FOUND, 404)

  try {
    const port = Number.parseInt(c.req.valid('param').port, 10)
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      return c.json({ error: 'Invalid port number' }, 400)
    }
    const { preview } = sandboxes
    if (!preview) {
      return c.json({ error: 'This sandbox backend offers no previews' }, 400)
    }
    const { url, headers, expiresAt } = await preview.url(sandboxId, port)
    return c.json({ sandbox_id: sandboxId, port, url, headers, expires_at: expiresAt }, 200)
  } catch (e) {
    const { body, status } = failure(e, 'get endpoint')
    return c.json(body, status)
  }
})

// ── DELETE /:id/sandboxes/:sandboxId ───────────────────────────────────────
const deleteRoute = createRoute({
  method: 'delete',
  path: '/{id}/sandboxes/{sandboxId}',
  tags: ['workspaces'],
  summary: 'Kill a workspace sandbox',
  security: [{ bearerAuth: [] }],
  request: { params: SandboxParam },
  responses: {
    200: { description: 'Killed', content: { 'application/json': { schema: SuccessSchema } } },
    404: sandboxNotFound,
    500: serverError,
  },
})

workspaceSandboxes.openapi(deleteRoute, async (c) => {
  const { id, sandboxId } = c.req.valid('param')
  const sandboxes = await sandboxesFor(c, id)
  if (!sandboxes) return c.json(WORKSPACE_NOT_FOUND, 404)

  try {
    await sandboxes.kill(sandboxId)
    return c.json({ success: true }, 200)
  } catch (e) {
    const { body, status } = failure(e, 'delete')
    return c.json(body, status)
  }
})

// ── Commands ───────────────────────────────────────────────────────────────
const CommandParam = SandboxParam.extend({
  commandId: z.string().openapi({ param: { name: 'commandId', in: 'path' } }),
})

const CommandResultSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  exit_code: z.number().nullable(),
  execution_time_ms: z.number().optional(),
})
const BackgroundCommandSchema = z.object({ command_id: z.string() })
const CommandStatusSchema = z.object({
  command_id: z.string(),
  running: z.boolean(),
  exit_code: z.number().nullable(),
  error: z.string().optional(),
  started_at: z.string().nullable().optional(),
  finished_at: z.string().nullable().optional(),
})

const runCommandRoute = createRoute({
  method: 'post',
  path: '/{id}/sandboxes/{sandboxId}/commands',
  tags: ['workspaces'],
  summary:
    'Run a shell command in a sandbox. Foreground returns stdout, stderr and exit_code; with background it returns a command_id to poll.',
  security: [{ bearerAuth: [] }],
  request: {
    params: SandboxParam,
    body: {
      content: {
        'application/json': {
          schema: z.object({
            command: z.string().openapi({ example: 'ls -la /tmp' }),
            cwd: z.string().optional(),
            env: z.record(z.string(), z.string()).optional(),
            timeout_seconds: z.number().positive().optional(),
            background: z.boolean().optional().openapi({
              description:
                'Return as soon as the command starts; poll with the returned command_id. Rejected by sandbox backends without background commands.',
            }),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Command result, or the ID of the started background command',
      content: {
        'application/json': { schema: z.union([CommandResultSchema, BackgroundCommandSchema]) },
      },
    },
    400: badRequest,
    404: sandboxNotFound,
    500: serverError,
  },
})

workspaceSandboxes.openapi(runCommandRoute, async (c) => {
  const { id, sandboxId } = c.req.valid('param')
  const sandboxes = await sandboxesFor(c, id)
  if (!sandboxes) return c.json(WORKSPACE_NOT_FOUND, 404)

  try {
    const body = c.req.valid('json')
    const opts = { cwd: body.cwd, env: body.env, timeoutSeconds: body.timeout_seconds }
    if (body.background) {
      if (!sandboxes.commands) {
        return c.json({ error: 'This sandbox backend cannot run background commands' }, 400)
      }
      const { commandId } = await sandboxes.commands.start(sandboxId, body.command, opts)
      return c.json({ command_id: commandId }, 200)
    }
    const result = await sandboxes.exec(sandboxId, body.command, opts)
    return c.json(
      {
        stdout: result.stdout,
        stderr: result.stderr,
        exit_code: result.exitCode,
        execution_time_ms: result.executionTimeMs,
      },
      200,
    )
  } catch (e) {
    const { body, status } = failure(e, 'run command')
    return c.json(body, status)
  }
})

const commandStatusRoute = createRoute({
  method: 'get',
  path: '/{id}/sandboxes/{sandboxId}/commands/{commandId}',
  tags: ['workspaces'],
  summary: 'Get the status of a background command (running, exit_code, timing)',
  security: [{ bearerAuth: [] }],
  request: { params: CommandParam },
  responses: {
    200: {
      description: 'Command status',
      content: { 'application/json': { schema: CommandStatusSchema } },
    },
    400: badRequest,
    404: sandboxNotFound,
    500: serverError,
  },
})

workspaceSandboxes.openapi(commandStatusRoute, async (c) => {
  const { id, sandboxId, commandId } = c.req.valid('param')
  const sandboxes = await sandboxesFor(c, id)
  if (!sandboxes) return c.json(WORKSPACE_NOT_FOUND, 404)

  try {
    const { commands } = sandboxes
    if (!commands || commands.kind === 'stream') {
      return c.json({ error: 'This sandbox backend does not keep background command status' }, 400)
    }
    const s = await commands.status(sandboxId, commandId)
    return c.json(
      {
        command_id: s.commandId,
        running: s.running,
        exit_code: s.exitCode,
        error: s.error,
        started_at: s.startedAt,
        finished_at: s.finishedAt,
      },
      200,
    )
  } catch (e) {
    const { body, status } = failure(e, 'get command status')
    return c.json(body, status)
  }
})

const commandLogsRoute = createRoute({
  method: 'get',
  path: '/{id}/sandboxes/{sandboxId}/commands/{commandId}/logs',
  tags: ['workspaces'],
  summary:
    'Get output of a background command as { content, cursor }. When cursor is present, pass it back to read only newer output; without it, each call returns the whole log.',
  security: [{ bearerAuth: [] }],
  request: {
    params: CommandParam,
    query: z.object({
      cursor: z.coerce
        .number()
        .int()
        .min(0)
        .optional()
        .openapi({ param: { name: 'cursor', in: 'query' } }),
    }),
  },
  responses: {
    200: {
      description: 'Command logs',
      content: {
        'application/json': {
          schema: z.object({ content: z.string(), cursor: z.number().optional() }),
        },
      },
    },
    400: badRequest,
    404: sandboxNotFound,
    500: serverError,
  },
})

workspaceSandboxes.openapi(commandLogsRoute, async (c) => {
  const { id, sandboxId, commandId } = c.req.valid('param')
  const sandboxes = await sandboxesFor(c, id)
  if (!sandboxes) return c.json(WORKSPACE_NOT_FOUND, 404)

  try {
    const { commands } = sandboxes
    if (!commands || commands.kind === 'stream') {
      return c.json({ error: 'This sandbox backend does not keep background command output' }, 400)
    }
    const { cursor } = c.req.valid('query')
    const logs = await commands.logs(sandboxId, commandId, cursor)
    return c.json({ content: logs.content, cursor: logs.cursor }, 200)
  } catch (e) {
    const { body, status } = failure(e, 'get command logs')
    return c.json(body, status)
  }
})

const interruptCommandRoute = createRoute({
  method: 'post',
  path: '/{id}/sandboxes/{sandboxId}/commands/{commandId}/interrupt',
  tags: ['workspaces'],
  summary: 'Interrupt a running background command',
  security: [{ bearerAuth: [] }],
  request: { params: CommandParam },
  responses: {
    200: { description: 'Interrupted', content: { 'application/json': { schema: SuccessSchema } } },
    400: badRequest,
    404: sandboxNotFound,
    500: serverError,
  },
})

workspaceSandboxes.openapi(interruptCommandRoute, async (c) => {
  const { id, sandboxId, commandId } = c.req.valid('param')
  const sandboxes = await sandboxesFor(c, id)
  if (!sandboxes) return c.json(WORKSPACE_NOT_FOUND, 404)

  try {
    const interrupt = sandboxes.commands?.interrupt
    if (!interrupt) {
      return c.json({ error: 'This sandbox backend cannot interrupt commands' }, 400)
    }
    await interrupt(sandboxId, commandId)
    return c.json({ success: true }, 200)
  } catch (e) {
    const { body, status } = failure(e, 'interrupt command')
    return c.json(body, status)
  }
})

// ── Files ──────────────────────────────────────────────────────────────────
const writeFilesRoute = createRoute({
  method: 'post',
  path: '/{id}/sandboxes/{sandboxId}/files',
  tags: ['workspaces'],
  summary: 'Write files inside a sandbox. Parent directories are created automatically.',
  security: [{ bearerAuth: [] }],
  request: {
    params: SandboxParam,
    body: {
      content: {
        'application/json': {
          schema: z.object({
            files: z.array(
              z.object({
                path: z.string().openapi({ description: 'Absolute path inside the sandbox' }),
                content: z.string(),
              }),
            ),
          }),
        },
      },
    },
  },
  responses: {
    200: { description: 'Written', content: { 'application/json': { schema: SuccessSchema } } },
    404: sandboxNotFound,
    500: serverError,
  },
})

workspaceSandboxes.openapi(writeFilesRoute, async (c) => {
  const { id, sandboxId } = c.req.valid('param')
  const sandboxes = await sandboxesFor(c, id)
  if (!sandboxes) return c.json(WORKSPACE_NOT_FOUND, 404)

  try {
    const { files } = c.req.valid('json')
    await sandboxes.files.write(sandboxId, files)
    return c.json({ success: true }, 200)
  } catch (e) {
    const { body, status } = failure(e, 'write files')
    return c.json(body, status)
  }
})

const readFileRoute = createRoute({
  method: 'get',
  path: '/{id}/sandboxes/{sandboxId}/files',
  tags: ['workspaces'],
  summary: 'Read a file from a sandbox',
  security: [{ bearerAuth: [] }],
  request: {
    params: SandboxParam,
    query: z.object({
      path: z.string().openapi({ param: { name: 'path', in: 'query' } }),
      offset: z.coerce
        .number()
        .int()
        .min(0)
        .optional()
        .openapi({ param: { name: 'offset', in: 'query' } }),
      limit: z.coerce
        .number()
        .int()
        .positive()
        .optional()
        .openapi({ param: { name: 'limit', in: 'query' } }),
    }),
  },
  responses: {
    200: {
      description: 'File content',
      content: { 'application/json': { schema: z.object({ content: z.string() }) } },
    },
    404: sandboxNotFound,
    500: serverError,
  },
})

workspaceSandboxes.openapi(readFileRoute, async (c) => {
  const { id, sandboxId } = c.req.valid('param')
  const sandboxes = await sandboxesFor(c, id)
  if (!sandboxes) return c.json(WORKSPACE_NOT_FOUND, 404)

  try {
    const { path, offset, limit } = c.req.valid('query')
    return c.json({ content: await sandboxes.files.read(sandboxId, path, { offset, limit }) }, 200)
  } catch (e) {
    const { body, status } = failure(e, 'read file')
    return c.json(body, status)
  }
})

const listDirectoryRoute = createRoute({
  method: 'get',
  path: '/{id}/sandboxes/{sandboxId}/directory',
  tags: ['workspaces'],
  summary: 'List a directory inside a sandbox',
  security: [{ bearerAuth: [] }],
  request: {
    params: SandboxParam,
    query: z.object({ path: z.string().openapi({ param: { name: 'path', in: 'query' } }) }),
  },
  responses: {
    200: {
      description: 'Directory entries',
      content: {
        'application/json': {
          schema: z.object({
            files: z.array(
              z.object({
                path: z.string(),
                type: z.string().optional(),
                size: z.number().optional(),
                modified_at: z.string().optional(),
              }),
            ),
          }),
        },
      },
    },
    400: badRequest,
    404: sandboxNotFound,
    500: serverError,
  },
})

workspaceSandboxes.openapi(listDirectoryRoute, async (c) => {
  const { id, sandboxId } = c.req.valid('param')
  const sandboxes = await sandboxesFor(c, id)
  if (!sandboxes) return c.json(WORKSPACE_NOT_FOUND, 404)

  try {
    const { listDirectory } = sandboxes.files
    if (!listDirectory) {
      return c.json({ error: 'This sandbox backend cannot list directories' }, 400)
    }
    const entries = await listDirectory(sandboxId, c.req.valid('query').path)
    return c.json(
      {
        files: entries.map((f) => ({
          path: f.path,
          type: f.type,
          size: f.size,
          modified_at: f.modifiedAt,
        })),
      },
      200,
    )
  } catch (e) {
    const { body, status } = failure(e, 'list directory')
    return c.json(body, status)
  }
})

export default workspaceSandboxes
