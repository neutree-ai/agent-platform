import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { AppEnv } from '../lib/types'
import { canAccessWorkspace } from '../lib/workspace-access'
import { getPlatformToken } from '../services/db/shares'
import { getWorkspace } from '../services/db/workspaces'
import * as sandbox from '../services/sandbox'

// Look up (or lazy-mint) the workspace owner's platform service token, the
// same mechanism browser-routes use. Lets us forward a real per-user
// bearer to sandbox-service even on cookie-authenticated UI requests, so
// the downstream sees the real user identity (instead of a synthetic
// service principal) for quota / audit / future per-user enforcement.
async function getOwnerToken(workspace: { user_id: string }): Promise<string> {
  const token = await getPlatformToken(workspace.user_id)
  if (!token) throw new Error('No platform token for workspace owner')
  return token
}

const workspaceSandboxes = new OpenAPIHono<AppEnv>()

const ErrorSchema = z.object({ error: z.string() })
const SuccessSchema = z.object({ success: z.boolean() })

const SandboxInfoSchema = z
  .object({
    id: z.string(),
    status: z.any().openapi({ description: 'Sandbox status as reported by the runtime' }),
    expiresAt: z.string().nullable().optional(),
    metadata: z.record(z.string(), z.string()).optional(),
  })
  .loose()
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
    404: notFound,
    500: serverError,
  },
})

workspaceSandboxes.openapi(createRouteDef, async (c) => {
  const currentUser = c.get('user')
  const { id } = c.req.valid('param')
  const workspace = await getWorkspace(id)

  if (!workspace || !(await canAccessWorkspace(workspace, currentUser))) {
    return c.json({ error: 'Workspace not found' }, 404)
  }

  try {
    const body = c.req.valid('json')
    const token = await getOwnerToken(workspace)
    const info = await sandbox.createSandbox(token, {
      image: body.image,
      resource: body.resource,
      timeoutSeconds: body.timeout_seconds,
      env: body.env,
      metadata: { workspace_id: id },
    })
    return c.json(info, 201)
  } catch (e: any) {
    console.error('[sandbox] create failed:', e)
    return c.json({ error: e.message }, 500)
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
      content: { 'application/json': { schema: z.object({}).loose() } },
    },
    404: notFound,
    500: serverError,
  },
})

workspaceSandboxes.openapi(listRoute, async (c) => {
  const currentUser = c.get('user')
  const { id } = c.req.valid('param')
  const workspace = await getWorkspace(id)

  if (!workspace || !(await canAccessWorkspace(workspace, currentUser))) {
    return c.json({ error: 'Workspace not found' }, 404)
  }

  try {
    const token = await getOwnerToken(workspace)
    const result = await sandbox.listSandboxes(token, {
      metadata: { workspace_id: id },
    })
    return c.json(result, 200)
  } catch (e: any) {
    console.error('[sandbox] list failed:', e)
    return c.json({ error: e.message }, 500)
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
    404: notFound,
    500: serverError,
  },
})

workspaceSandboxes.openapi(renewRoute, async (c) => {
  const currentUser = c.get('user')
  const { id, sandboxId } = c.req.valid('param')
  const workspace = await getWorkspace(id)

  if (!workspace || !(await canAccessWorkspace(workspace, currentUser))) {
    return c.json({ error: 'Workspace not found' }, 404)
  }

  try {
    const body = c.req.valid('json') ?? {}
    const token = await getOwnerToken(workspace)
    const result = await sandbox.renewSandbox(token, sandboxId, body.extend_seconds ?? 3600)
    return c.json({ sandbox_id: sandboxId, expires_at: result.expiresAt }, 200)
  } catch (e: any) {
    console.error('[sandbox] renew failed:', e)
    return c.json({ error: e.message }, 500)
  }
})

// ── GET /:id/sandboxes/:sandboxId/endpoint/:port ───────────────────────────
const endpointRoute = createRoute({
  method: 'get',
  path: '/{id}/sandboxes/{sandboxId}/endpoint/{port}',
  tags: ['workspaces'],
  summary: 'Get the URL of a port exposed by a sandbox',
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
          schema: z.object({ sandbox_id: z.string(), port: z.number(), url: z.string() }),
        },
      },
    },
    400: {
      description: 'Invalid port number',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: notFound,
    500: serverError,
  },
})

workspaceSandboxes.openapi(endpointRoute, async (c) => {
  const currentUser = c.get('user')
  const { id, sandboxId } = c.req.valid('param')
  const workspace = await getWorkspace(id)

  if (!workspace || !(await canAccessWorkspace(workspace, currentUser))) {
    return c.json({ error: 'Workspace not found' }, 404)
  }

  try {
    const token = await getOwnerToken(workspace)
    const port = Number.parseInt(c.req.valid('param').port, 10)
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      return c.json({ error: 'Invalid port number' }, 400)
    }
    const url = await sandbox.getEndpoint(token, sandboxId, port)
    return c.json({ sandbox_id: sandboxId, port, url }, 200)
  } catch (e: any) {
    console.error('[sandbox] get endpoint failed:', e)
    return c.json({ error: e.message }, 500)
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
    404: notFound,
    500: serverError,
  },
})

workspaceSandboxes.openapi(deleteRoute, async (c) => {
  const currentUser = c.get('user')
  const { id, sandboxId } = c.req.valid('param')
  const workspace = await getWorkspace(id)

  if (!workspace || !(await canAccessWorkspace(workspace, currentUser))) {
    return c.json({ error: 'Workspace not found' }, 404)
  }

  try {
    const token = await getOwnerToken(workspace)
    await sandbox.deleteSandbox(token, sandboxId)
    return c.json({ success: true }, 200)
  } catch (e: any) {
    console.error('[sandbox] delete failed:', e)
    return c.json({ error: e.message }, 500)
  }
})

export default workspaceSandboxes
