import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  type ApiTag,
  ApiTagSchema,
  TagCreateBodySchema,
  TagUpdateBodySchema,
  WorkspaceTagsBodySchema,
} from '../../../internal/types/api'
import type { AppEnv } from '../lib/types'
import {
  createTag,
  deleteTag,
  listUserTags,
  setWorkspaceTags,
  updateTag,
} from '../services/db/tags'
import type { WorkspaceTag } from '../services/db/types'
import { getWorkspace } from '../services/db/workspaces'

const tags = new OpenAPIHono<AppEnv>()

const ErrorSchema = z.object({ error: z.string() })
const SuccessSchema = z.object({ success: z.boolean() })

const IdParam = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' } }),
})

const WorkspaceIdParam = z.object({
  workspaceId: z.string().openapi({ param: { name: 'workspaceId', in: 'path' } }),
})

function toApiTag(t: WorkspaceTag): ApiTag {
  return {
    id: t.id,
    name: t.name,
    color: t.color,
    created_at: t.created_at,
  }
}

// ── GET / ──────────────────────────────────────────────────────────────────
const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['tags'],
  summary: "List the current user's tags",
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Tag list',
      content: { 'application/json': { schema: z.array(ApiTagSchema) } },
    },
  },
})

tags.openapi(listRoute, async (c) => {
  const user = c.get('user')
  const list = await listUserTags(user.sub)
  return c.json(list.map(toApiTag), 200)
})

// ── POST / ─────────────────────────────────────────────────────────────────
const createRouteDef = createRoute({
  method: 'post',
  path: '/',
  tags: ['tags'],
  summary: 'Create a tag',
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { 'application/json': { schema: TagCreateBodySchema } } },
  },
  responses: {
    201: { description: 'Created tag', content: { 'application/json': { schema: ApiTagSchema } } },
    409: {
      description: 'Name already in use',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

tags.openapi(createRouteDef, async (c) => {
  const user = c.get('user')
  const body = c.req.valid('json')
  const color = body.color || 'slate'

  try {
    const tag = await createTag(user.sub, body.name, color)
    return c.json(toApiTag(tag), 201)
  } catch (e: any) {
    if (e.code === '23505') {
      return c.json({ error: 'Tag name already exists' }, 409)
    }
    throw e
  }
})

// ── PUT /:id ───────────────────────────────────────────────────────────────
const updateRoute = createRoute({
  method: 'put',
  path: '/{id}',
  tags: ['tags'],
  summary: 'Update a tag',
  security: [{ bearerAuth: [] }],
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: TagUpdateBodySchema } } },
  },
  responses: {
    200: { description: 'Updated tag', content: { 'application/json': { schema: ApiTagSchema } } },
    404: { description: 'Tag not found', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

tags.openapi(updateRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const body = c.req.valid('json')

  const updates: { name?: string; color?: string } = {}
  if (body.name !== undefined) updates.name = body.name
  if (body.color !== undefined) updates.color = body.color

  const tag = await updateTag(id, user.sub, updates)
  if (!tag) return c.json({ error: 'Tag not found' }, 404)
  return c.json(toApiTag(tag), 200)
})

// ── DELETE /:id ────────────────────────────────────────────────────────────
const deleteRouteDef = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['tags'],
  summary: 'Delete a tag',
  security: [{ bearerAuth: [] }],
  request: { params: IdParam },
  responses: {
    200: { description: 'Deleted', content: { 'application/json': { schema: SuccessSchema } } },
    404: { description: 'Tag not found', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

tags.openapi(deleteRouteDef, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const deleted = await deleteTag(id, user.sub)
  if (!deleted) return c.json({ error: 'Tag not found' }, 404)
  return c.json({ success: true }, 200)
})

// ── PUT /workspace/:workspaceId ────────────────────────────────────────────
const setWorkspaceTagsRoute = createRoute({
  method: 'put',
  path: '/workspace/{workspaceId}',
  tags: ['tags'],
  summary: 'Replace the tag set applied to a workspace',
  security: [{ bearerAuth: [] }],
  request: {
    params: WorkspaceIdParam,
    body: { content: { 'application/json': { schema: WorkspaceTagsBodySchema } } },
  },
  responses: {
    200: { description: 'Applied', content: { 'application/json': { schema: SuccessSchema } } },
    404: {
      description: 'Workspace not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

tags.openapi(setWorkspaceTagsRoute, async (c) => {
  const user = c.get('user')
  const { workspaceId } = c.req.valid('param')

  const workspace = await getWorkspace(workspaceId)
  if (!workspace || workspace.user_id !== user.sub) {
    return c.json({ error: 'Workspace not found' }, 404)
  }

  const body = c.req.valid('json')
  await setWorkspaceTags(workspaceId, body.tag_ids)
  return c.json({ success: true }, 200)
})

export default tags
