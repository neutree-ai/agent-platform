import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { ApiPromptSchema, ApiPromptVersionSchema } from '../../../../internal/types/api'
import type { AppEnv } from '../../lib/types'
import { getPromptForUser, listPromptVersions, listVisibleToUser } from '../../services/db/prompts'
import { toApi, toVersionApi } from './_shared'

const read = new OpenAPIHono<AppEnv>()

const ErrorSchema = z.object({ error: z.string() })

const IdParam = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' } }),
})

// ── GET / ──────────────────────────────────────────────────────────────────
const listVisibleRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['prompts'],
  summary: 'List prompts visible to the user (own + public + team-shared)',
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Prompt list',
      content: { 'application/json': { schema: z.array(ApiPromptSchema) } },
    },
  },
})

read.openapi(listVisibleRoute, async (c) => {
  const user = c.get('user')
  const list = await listVisibleToUser(user.sub)
  return c.json(list.map(toApi), 200)
})

// ── GET /public ────────────────────────────────────────────────────────────
const listPublicRoute = createRoute({
  method: 'get',
  path: '/public',
  tags: ['prompts'],
  summary: 'List public prompts',
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Public prompt list',
      content: { 'application/json': { schema: z.array(ApiPromptSchema) } },
    },
  },
})

read.openapi(listPublicRoute, async (c) => {
  const user = c.get('user')
  const list = await listVisibleToUser(user.sub)
  return c.json(list.filter((p) => p.visibility === 'public').map(toApi), 200)
})

// ── GET /:id ───────────────────────────────────────────────────────────────
const getRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['prompts'],
  summary: 'Get a prompt (visibility-aware)',
  security: [{ bearerAuth: [] }],
  request: { params: IdParam },
  responses: {
    200: { description: 'Prompt', content: { 'application/json': { schema: ApiPromptSchema } } },
    404: {
      description: 'Prompt not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

read.openapi(getRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const prompt = await getPromptForUser(id, user.sub)
  if (!prompt) return c.json({ error: 'Prompt not found' }, 404)
  return c.json(toApi(prompt), 200)
})

// ── GET /:id/versions ──────────────────────────────────────────────────────
const versionsRoute = createRoute({
  method: 'get',
  path: '/{id}/versions',
  tags: ['prompts'],
  summary: 'List prompt versions (visibility-aware)',
  security: [{ bearerAuth: [] }],
  request: { params: IdParam },
  responses: {
    200: {
      description: 'Version list',
      content: { 'application/json': { schema: z.array(ApiPromptVersionSchema) } },
    },
    404: {
      description: 'Prompt not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

read.openapi(versionsRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const prompt = await getPromptForUser(id, user.sub)
  if (!prompt) return c.json({ error: 'Prompt not found' }, 404)
  const versions = await listPromptVersions(id)
  return c.json(versions.map(toVersionApi), 200)
})

export default read
