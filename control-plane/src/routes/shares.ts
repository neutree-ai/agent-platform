import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  ApiShareDataSchema,
  ApiShareSchema,
  ShareCreateBodySchema,
  ShareListQuerySchema,
  SharePatchBodySchema,
} from '../../../internal/types/api'
import * as jobs from '../lib/jobs'
import type { AppEnv } from '../lib/types'
import { getMessagesWithBlocks } from '../services/db/messages'
import { getSession } from '../services/db/sessions'
import {
  createShare,
  deleteShare,
  getShareWithOwner,
  listSharesBySession,
  listSharesByWorkspace,
  updateShareTitle,
} from '../services/db/shares'
import { getWorkspace, getWorkspaceConfig } from '../services/db/workspaces'
import { skillRepo } from '../services/skills-composition'

const shares = new OpenAPIHono<AppEnv>()

const ErrorSchema = z.object({ error: z.string() })
const SuccessSchema = z.object({ success: z.boolean() })

const IdParam = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' } }),
})

// ── POST / ─────────────────────────────────────────────────────────────────
const createRouteDef = createRoute({
  method: 'post',
  path: '/',
  tags: ['shares'],
  summary: 'Create a share by snapshotting session messages, config and trigger',
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { 'application/json': { schema: ShareCreateBodySchema } } },
  },
  responses: {
    200: {
      description: 'Created share',
      content: { 'application/json': { schema: ApiShareSchema } },
    },
    404: {
      description: 'Workspace not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

shares.openapi(createRouteDef, async (c) => {
  const user = c.get('user')
  const { workspace_id, session_id, title } = c.req.valid('json')

  const workspace = await getWorkspace(workspace_id)
  if (!workspace || workspace.user_id !== user.sub) {
    return c.json({ error: 'Workspace not found' }, 404)
  }

  const messages = await getMessagesWithBlocks(workspace_id, session_id)
  const snapshotMessages = messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    blocks: m.blocks,
    created_at: m.created_at,
  }))

  const session = await getSession(session_id)
  const turnStats = session?.last_turn_stats ?? null

  const config = await getWorkspaceConfig(workspace_id)
  // Share snapshots the displayed skill names at create time — viewer renders
  // them as badges. p3: ids are the canonical reference, but the share JSON
  // historically stored string[]; resolve ids → names here so the existing
  // SharePage renderer keeps working unchanged.
  const skillIds = await skillRepo.getWorkspaceSkillIds(workspace_id)
  const skillMetas = await Promise.all(skillIds.map((id) => skillRepo.getSkillMeta(id)))
  const skills: string[] = skillMetas.map((m) => m?.name ?? '(unknown)')
  const workspaceConfig = config
    ? {
        agent_type: config.agent_type,
        model: config.model,
        system_prompt: config.prompt_content || config.system_prompt,
        skills,
        template_name: config.template_name || null,
        template_version: config.template_version || null,
      }
    : null

  let trigger: { type: string; schedule_name?: string; created_at?: string } | null = null
  try {
    const job = await jobs.getJobBySessionId(session_id)
    if (job?.data?.trigger) {
      const t = job.data.trigger as { type: string; payload?: Record<string, unknown> }
      trigger = { type: t.type, created_at: job.created_on }
      if (t.payload?.schedule_name) {
        trigger.schedule_name = t.payload.schedule_name as string
      }
    }
  } catch {
    // pg-boss table may not exist in some setups — skip
  }

  const data = {
    messages: snapshotMessages,
    turnStats,
    workspaceConfig,
    trigger,
  }
  const shareTitle = title || session?.name || 'Shared session'

  const share = await createShare(user.sub, workspace_id, session_id, shareTitle, data)

  return c.json(
    {
      id: share.id,
      url: `/s/${share.id}`,
      title: share.title,
      created_at: share.created_at,
    },
    200,
  )
})

// ── GET / ──────────────────────────────────────────────────────────────────
const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['shares'],
  summary: 'List shares created for a given workspace session',
  security: [{ bearerAuth: [] }],
  request: { query: ShareListQuerySchema },
  responses: {
    200: {
      description: 'Share list',
      content: { 'application/json': { schema: z.array(ApiShareSchema) } },
    },
    404: {
      description: 'Workspace not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

shares.openapi(listRoute, async (c) => {
  const user = c.get('user')
  const { workspace_id, session_id } = c.req.valid('query')

  const workspace = await getWorkspace(workspace_id)
  if (!workspace || workspace.user_id !== user.sub) {
    return c.json({ error: 'Workspace not found' }, 404)
  }

  const list = session_id
    ? await listSharesBySession(workspace_id, session_id)
    : await listSharesByWorkspace(workspace_id)
  return c.json(
    list.map((s) => ({
      id: s.id,
      url: `/s/${s.id}`,
      title: s.title,
      created_at: s.created_at,
      session_id: s.session_id,
    })),
    200,
  )
})

// ── PATCH /:id ─────────────────────────────────────────────────────────────
const patchRoute = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['shares'],
  summary: 'Update a share title (owner only)',
  security: [{ bearerAuth: [] }],
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: SharePatchBodySchema } } },
  },
  responses: {
    200: { description: 'Updated', content: { 'application/json': { schema: SuccessSchema } } },
    404: {
      description: 'Share not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

shares.openapi(patchRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const { title } = c.req.valid('json')

  const updated = await updateShareTitle(id, user.sub, title)
  if (!updated) return c.json({ error: 'Share not found' }, 404)
  return c.json({ success: true }, 200)
})

// ── DELETE /:id ────────────────────────────────────────────────────────────
const deleteRouteDef = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['shares'],
  summary: 'Delete a share (owner only)',
  security: [{ bearerAuth: [] }],
  request: { params: IdParam },
  responses: {
    200: { description: 'Deleted', content: { 'application/json': { schema: SuccessSchema } } },
    404: {
      description: 'Share not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

shares.openapi(deleteRouteDef, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')

  const deleted = await deleteShare(id, user.sub)
  if (!deleted) return c.json({ error: 'Share not found' }, 404)
  return c.json({ success: true }, 200)
})

// ── GET /public/:id ────────────────────────────────────────────────────────
const publicRoute = createRoute({
  method: 'get',
  path: '/public/{id}',
  tags: ['shares'],
  summary: 'Public share view (no authentication required)',
  description: 'Auth bypass is configured via path prefix in index.ts.',
  request: { params: IdParam },
  responses: {
    200: {
      description: 'Share snapshot',
      content: { 'application/json': { schema: ApiShareDataSchema } },
    },
    404: {
      description: 'Share not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

shares.openapi(publicRoute, async (c) => {
  const { id } = c.req.valid('param')
  const share = await getShareWithOwner(id)
  if (!share) return c.json({ error: 'Share not found' }, 404)

  return c.json(
    {
      title: share.title,
      created_at: share.created_at,
      owner_name: share.owner_name,
      ...(share.data as object),
    } as any,
    200,
  )
})

export default shares
