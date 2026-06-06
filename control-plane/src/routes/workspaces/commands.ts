import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  ApiWorkspaceCommandSchema,
  WorkspaceCommandCreateBodySchema,
  WorkspaceCommandPatchBodySchema,
} from '../../../../internal/types/api'
import type { AppEnv } from '../../lib/types'
import {
  createWorkspaceCommand,
  deleteWorkspaceCommand,
  getWorkspaceCommand,
  listWorkspaceCommands,
  setTemplateCommandDisabled,
  updateWorkspaceCommand,
} from '../../services/db/commands'
import { getWorkspace } from '../../services/db/workspaces'

const commands = new OpenAPIHono<AppEnv>()

const ErrorSchema = z.object({ error: z.string() })
const SuccessSchema = z.object({ success: z.boolean() })

const WorkspaceIdParam = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' } }),
})

const CommandParam = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' } }),
  cmdId: z.string().openapi({ param: { name: 'cmdId', in: 'path' } }),
})

// ── GET /:id/commands ──────────────────────────────────────────────────────
const listRoute = createRoute({
  method: 'get',
  path: '/{id}/commands',
  tags: ['workspaces'],
  summary: 'List workspace commands',
  security: [{ bearerAuth: [] }],
  request: { params: WorkspaceIdParam },
  responses: {
    200: {
      description: 'Commands wrapped in `{ commands: [...] }`',
      content: {
        'application/json': {
          schema: z.object({ commands: z.array(ApiWorkspaceCommandSchema) }),
        },
      },
    },
    404: {
      description: 'Workspace not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

commands.openapi(listRoute, async (c) => {
  const currentUser = c.get('user')
  const { id } = c.req.valid('param')
  const workspace = await getWorkspace(id)
  if (!workspace || workspace.user_id !== currentUser.sub) {
    return c.json({ error: 'Workspace not found' }, 404)
  }
  const list = await listWorkspaceCommands(id)
  return c.json({ commands: list }, 200)
})

// ── POST /:id/commands ─────────────────────────────────────────────────────
const createRouteDef = createRoute({
  method: 'post',
  path: '/{id}/commands',
  tags: ['workspaces'],
  summary: 'Create a command. Either prompt_id or content must be provided.',
  security: [{ bearerAuth: [] }],
  request: {
    params: WorkspaceIdParam,
    body: { content: { 'application/json': { schema: WorkspaceCommandCreateBodySchema } } },
  },
  responses: {
    201: {
      description: 'Created command',
      content: {
        'application/json': {
          schema: z.object({ command: ApiWorkspaceCommandSchema }),
        },
      },
    },
    400: { description: 'Invalid input', content: { 'application/json': { schema: ErrorSchema } } },
    404: {
      description: 'Workspace not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

commands.openapi(createRouteDef, async (c) => {
  const currentUser = c.get('user')
  const { id } = c.req.valid('param')
  const workspace = await getWorkspace(id)
  if (!workspace || workspace.user_id !== currentUser.sub) {
    return c.json({ error: 'Workspace not found' }, 404)
  }

  const body = c.req.valid('json')
  if (!body.prompt_id && !body.content) {
    return c.json({ error: 'prompt_id or content is required' }, 400)
  }

  const command = await createWorkspaceCommand({
    workspace_id: id,
    user_id: currentUser.sub,
    name: body.name,
    type: body.type || 'plain',
    prompt_id: body.prompt_id,
    content: body.content,
    sort_order: body.sort_order,
  })
  return c.json({ command: { ...command, source: 'local' as const } }, 201)
})

// ── PATCH /:id/commands/:cmdId ─────────────────────────────────────────────
const patchRoute = createRoute({
  method: 'patch',
  path: '/{id}/commands/{cmdId}',
  tags: ['workspaces'],
  summary: 'Update a command',
  security: [{ bearerAuth: [] }],
  request: {
    params: CommandParam,
    body: { content: { 'application/json': { schema: WorkspaceCommandPatchBodySchema } } },
  },
  responses: {
    200: {
      description: 'Updated command',
      content: {
        'application/json': {
          schema: z.object({ command: ApiWorkspaceCommandSchema }),
        },
      },
    },
    404: {
      description: 'Workspace or command not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

commands.openapi(patchRoute, async (c) => {
  const currentUser = c.get('user')
  const { id, cmdId } = c.req.valid('param')

  const workspace = await getWorkspace(id)
  if (!workspace || workspace.user_id !== currentUser.sub) {
    return c.json({ error: 'Workspace not found' }, 404)
  }

  const existing = await getWorkspaceCommand(cmdId)
  if (!existing || existing.workspace_id !== id) {
    return c.json({ error: 'Command not found' }, 404)
  }

  const body = c.req.valid('json')
  const command = await updateWorkspaceCommand(cmdId, body)
  if (!command) return c.json({ error: 'Command not found' }, 404)
  return c.json({ command: { ...command, source: 'local' as const } }, 200)
})

// ── DELETE /:id/commands/:cmdId ────────────────────────────────────────────
const deleteRouteDef = createRoute({
  method: 'delete',
  path: '/{id}/commands/{cmdId}',
  tags: ['workspaces'],
  summary: 'Delete a command',
  security: [{ bearerAuth: [] }],
  request: { params: CommandParam },
  responses: {
    200: { description: 'Deleted', content: { 'application/json': { schema: SuccessSchema } } },
    404: {
      description: 'Workspace or command not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

commands.openapi(deleteRouteDef, async (c) => {
  const currentUser = c.get('user')
  const { id, cmdId } = c.req.valid('param')

  const workspace = await getWorkspace(id)
  if (!workspace || workspace.user_id !== currentUser.sub) {
    return c.json({ error: 'Workspace not found' }, 404)
  }

  const existing = await getWorkspaceCommand(cmdId)
  if (!existing || existing.workspace_id !== id) {
    return c.json({ error: 'Command not found' }, 404)
  }

  await deleteWorkspaceCommand(cmdId)
  return c.json({ success: true }, 200)
})

// ── POST /:id/commands/set-disabled ────────────────────────────────────────
// Enable/disable a template-provided command for this workspace. Template
// commands are read-only base commands (no workspace_commands row of their
// own), so they're addressed by name rather than id.
const setDisabledRoute = createRoute({
  method: 'post',
  path: '/{id}/commands/set-disabled',
  tags: ['workspaces'],
  summary: 'Enable or disable a template-provided command for this workspace',
  security: [{ bearerAuth: [] }],
  request: {
    params: WorkspaceIdParam,
    body: {
      content: {
        'application/json': {
          schema: z.object({ name: z.string().min(1), disabled: z.boolean() }),
        },
      },
    },
  },
  responses: {
    200: { description: 'Updated', content: { 'application/json': { schema: SuccessSchema } } },
    404: {
      description: 'Workspace not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

commands.openapi(setDisabledRoute, async (c) => {
  const currentUser = c.get('user')
  const { id } = c.req.valid('param')
  const workspace = await getWorkspace(id)
  if (!workspace || workspace.user_id !== currentUser.sub) {
    return c.json({ error: 'Workspace not found' }, 404)
  }
  const { name, disabled } = c.req.valid('json')
  await setTemplateCommandDisabled(id, currentUser.sub, name, disabled)
  return c.json({ success: true }, 200)
})

export default commands
