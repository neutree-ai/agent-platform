import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  ApiCredentialMetaSchema,
  CredentialUpsertBodySchema,
} from '../../../internal/types/api'
import type { AppEnv } from '../lib/types'
import { notifyAgentReload } from '../lib/workspace-address'
import {
  hardDeleteUserCredentials,
  listUserCredentials,
  softDeleteUserCredential,
  upsertUserCredential,
} from '../services/db/credentials'
import { getWorkspace } from '../services/db/workspaces'
import { listWorkspaces } from '../services/db/workspaces'

const credentials = new OpenAPIHono<AppEnv>()

const ErrorSchema = z.object({ error: z.string() })
const SuccessSchema = z.object({ success: z.boolean() })

const NameParam = z.object({
  name: z.string().openapi({ param: { name: 'name', in: 'path' } }),
})

export async function reloadUserWorkspaces(userId: string): Promise<boolean> {
  const workspaces = await listWorkspaces(userId)
  const results = await Promise.all(
    workspaces
      .filter((w) => w.status === 'running')
      .map((w) => notifyAgentReload(w.id, ['credentials'])),
  )
  return results.length === 0 || results.every(Boolean)
}

// ── GET / ──────────────────────────────────────────────────────────────────
const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['credentials'],
  summary: 'List credential metadata for the current user (values are never returned)',
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Credential metadata list',
      content: { 'application/json': { schema: z.array(ApiCredentialMetaSchema) } },
    },
  },
})

credentials.openapi(listRoute, async (c) => {
  const currentUser = c.get('user')
  const creds = await listUserCredentials(currentUser.sub)
  return c.json(
    creds.map((cr) => ({
      name: cr.name,
      inject: cr.inject,
      path: cr.path,
      mode: cr.mode,
      scope: cr.scope as 'global' | 'selected',
      workspace_ids: cr.workspace_ids ?? [],
      updated_at: cr.updated_at,
    })),
    200,
  )
})

// ── PUT /:name ─────────────────────────────────────────────────────────────
const upsertRoute = createRoute({
  method: 'put',
  path: '/{name}',
  tags: ['credentials'],
  summary: 'Upsert a credential. For env injection the name must be a valid env var identifier.',
  security: [{ bearerAuth: [] }],
  request: {
    params: NameParam,
    body: { content: { 'application/json': { schema: CredentialUpsertBodySchema } } },
  },
  responses: {
    200: { description: 'Upserted', content: { 'application/json': { schema: SuccessSchema } } },
    400: { description: 'Invalid input', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

credentials.openapi(upsertRoute, async (c) => {
  const currentUser = c.get('user')
  const { name } = c.req.valid('param')
  const body = c.req.valid('json')

  if (body.inject === 'env' && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    return c.json(
      {
        error:
          'Environment variable name must contain only letters, digits, and underscores, and cannot start with a digit',
      },
      400,
    )
  }
  if (body.inject === 'file' && !body.path) {
    return c.json({ error: 'path is required for file injection' }, 400)
  }
  if (body.scope === 'selected') {
    if (!body.workspace_ids || body.workspace_ids.length === 0) {
      return c.json({ error: 'workspace_ids is required when scope is selected' }, 400)
    }
    // Verify all workspace_ids belong to this user
    for (const wsId of body.workspace_ids) {
      const ws = await getWorkspace(wsId)
      if (!ws || ws.user_id !== currentUser.sub) {
        return c.json({ error: `Workspace ${wsId} not found` }, 400)
      }
    }
  }

  await upsertUserCredential(
    currentUser.sub,
    name,
    body.value,
    body.inject,
    body.path,
    body.mode,
    body.scope,
    body.workspace_ids,
  )
  await reloadUserWorkspaces(currentUser.sub)
  return c.json({ success: true }, 200)
})

// ── DELETE /:name ──────────────────────────────────────────────────────────
const deleteRoute = createRoute({
  method: 'delete',
  path: '/{name}',
  tags: ['credentials'],
  summary: 'Soft-delete a credential, then hard-delete once all running workspaces reloaded',
  security: [{ bearerAuth: [] }],
  request: { params: NameParam },
  responses: {
    200: { description: 'Deleted', content: { 'application/json': { schema: SuccessSchema } } },
    404: {
      description: 'Credential not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

credentials.openapi(deleteRoute, async (c) => {
  const currentUser = c.get('user')
  const { name } = c.req.valid('param')
  const deleted = await softDeleteUserCredential(currentUser.sub, name)
  if (!deleted) return c.json({ error: 'Credential not found' }, 404)

  const allReloaded = await reloadUserWorkspaces(currentUser.sub)
  if (allReloaded) {
    await hardDeleteUserCredentials(currentUser.sub, [name])
  }
  return c.json({ success: true }, 200)
})

export default credentials
