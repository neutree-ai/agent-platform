import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  ApiWorkspaceLayoutSchema,
  WorkspaceLayoutCreateBodySchema,
  WorkspaceLayoutUpdateBodySchema,
} from '../../../internal/types/api'
import type { AppEnv } from '../lib/types'
import {
  createWorkspaceLayout,
  deleteWorkspaceLayout,
  getWorkspaceLayout,
  listWorkspaceLayouts,
  updateWorkspaceLayout,
} from '../services/db/workspace-layout'

/**
 * Reusable named layouts. `list` is owner-only; `get` by id is open (a layout
 * carries no sensitive content and is only resolved transiently to copy a
 * template's referenced row). Template-origin copies are sync-managed: they
 * can be deleted or forked (Save as new) but not edited in place.
 */
const layouts = new OpenAPIHono<AppEnv>()

const ErrorSchema = z.object({ error: z.string() })
const SuccessSchema = z.object({ success: z.boolean() })

const IdParam = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' } }),
})

// ── GET / ────────────────────────────────────────────────────────────────
const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['workspace-layouts'],
  summary: 'List my saved layouts',
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Layouts',
      content: { 'application/json': { schema: z.array(ApiWorkspaceLayoutSchema) } },
    },
  },
})

layouts.openapi(listRoute, async (c) => {
  const user = c.get('user')
  return c.json(await listWorkspaceLayouts(user.sub), 200)
})

// ── GET /{id} ────────────────────────────────────────────────────────────
const getRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['workspace-layouts'],
  summary: 'Resolve a layout by id (open read)',
  security: [{ bearerAuth: [] }],
  request: { params: IdParam },
  responses: {
    200: {
      description: 'Layout',
      content: { 'application/json': { schema: ApiWorkspaceLayoutSchema } },
    },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

layouts.openapi(getRoute, async (c) => {
  const { id } = c.req.valid('param')
  const layout = await getWorkspaceLayout(id)
  if (!layout) return c.json({ error: 'Layout not found' }, 404)
  return c.json(layout, 200)
})

// ── POST / ───────────────────────────────────────────────────────────────
const createRouteDef = createRoute({
  method: 'post',
  path: '/',
  tags: ['workspace-layouts'],
  summary: 'Create a layout',
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { 'application/json': { schema: WorkspaceLayoutCreateBodySchema } } },
  },
  responses: {
    201: {
      description: 'Created',
      content: { 'application/json': { schema: ApiWorkspaceLayoutSchema } },
    },
  },
})

layouts.openapi(createRouteDef, async (c) => {
  const user = c.get('user')
  const body = c.req.valid('json')
  const layout = await createWorkspaceLayout(user.sub, body)
  return c.json(layout, 201)
})

// ── PUT /{id} ──────────────────────────────────────────────────────────────
const updateRoute = createRoute({
  method: 'put',
  path: '/{id}',
  tags: ['workspace-layouts'],
  summary: 'Update a layout (owner; local-origin only)',
  security: [{ bearerAuth: [] }],
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: WorkspaceLayoutUpdateBodySchema } } },
  },
  responses: {
    200: {
      description: 'Updated',
      content: { 'application/json': { schema: ApiWorkspaceLayoutSchema } },
    },
    400: {
      description: 'Template-origin layout is read-only',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

layouts.openapi(updateRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const existing = await getWorkspaceLayout(id)
  if (!existing || existing.owner_id !== user.sub) {
    return c.json({ error: 'Layout not found' }, 404)
  }
  if (existing.origin === 'template') {
    // Sync-managed copy — fork to a new local layout to customize.
    return c.json(
      { error: 'Template-origin layout is read-only; save as a new layout to edit' },
      400,
    )
  }
  const updated = await updateWorkspaceLayout(id, c.req.valid('json'))
  return c.json(updated!, 200)
})

// ── DELETE /{id} ─────────────────────────────────────────────────────────
const deleteRouteDef = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['workspace-layouts'],
  summary: 'Delete a layout (owner)',
  security: [{ bearerAuth: [] }],
  request: { params: IdParam },
  responses: {
    200: { description: 'Deleted', content: { 'application/json': { schema: SuccessSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

layouts.openapi(deleteRouteDef, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const existing = await getWorkspaceLayout(id)
  if (!existing || existing.owner_id !== user.sub) {
    return c.json({ error: 'Layout not found' }, 404)
  }
  await deleteWorkspaceLayout(id)
  return c.json({ success: true }, 200)
})

export default layouts
