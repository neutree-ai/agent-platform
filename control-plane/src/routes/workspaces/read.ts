import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  ApiK8sStatusSchema,
  ApiMessageSchema,
  ApiSessionListSchema,
  ApiWorkspaceConfigSchema,
  ApiWorkspaceSchema,
} from '../../../../internal/types/api'
import type { AppEnv } from '../../lib/types'
import { listAttachmentsForWorkspace } from '../../services/db/memory'
import { getMessagesWithBlocks } from '../../services/db/messages'
import { listSessions } from '../../services/db/sessions'
import { getTagAssignmentsForUser } from '../../services/db/tags'
import type { SessionWithPreview } from '../../services/db/types'
import { getWorkspace, getWorkspaceConfig, listWorkspaces } from '../../services/db/workspaces'
import * as k8s from '../../services/k8s'
import { canManage, toApiWorkspace } from './_shared'

function toApiSession(s: SessionWithPreview) {
  return {
    id: s.id,
    workspace_id: s.workspace_id,
    name: s.name,
    status: s.status,
    chat_status: s.chat_status,
    created_at: s.created_at,
    last_active_at: s.last_active_at,
    message_count: s.message_count,
    preview: s.preview,
    last_turn_stats: s.last_turn_stats as any,
    starred_at: s.starred_at,
  }
}

const read = new OpenAPIHono<AppEnv>()

const ErrorSchema = z.object({ error: z.string() })

const WorkspaceIdParam = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' }, example: 'ws-abc123' }),
})

const getStatusRoute = createRoute({
  method: 'get',
  path: '/{id}/status',
  tags: ['workspaces'],
  summary: 'Get workspace runtime (K8s) status',
  security: [{ bearerAuth: [] }],
  request: { params: WorkspaceIdParam },
  responses: {
    200: {
      description: 'Current K8s deployment, service, and pod status',
      content: { 'application/json': { schema: ApiK8sStatusSchema } },
    },
    404: {
      description: 'Workspace not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    500: {
      description: 'Failed to query K8s',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

const getConfigRoute = createRoute({
  method: 'get',
  path: '/{id}/config',
  tags: ['workspaces'],
  summary: 'Get workspace agent configuration',
  description:
    'Returns the workspace config. `api_key` is always returned as an empty string; the stored value is write-only.',
  security: [{ bearerAuth: [] }],
  request: { params: WorkspaceIdParam },
  responses: {
    200: {
      description: 'Workspace agent configuration',
      content: { 'application/json': { schema: ApiWorkspaceConfigSchema } },
    },
    404: {
      description: 'Workspace or config not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

const listWorkspacesRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['workspaces'],
  summary: 'List workspaces visible to the current caller',
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      search: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }),
  },
  responses: {
    200: {
      description: 'List of workspaces',
      content: { 'application/json': { schema: z.array(ApiWorkspaceSchema) } },
    },
  },
})

read.openapi(listWorkspacesRoute, async (c) => {
  const currentUser = c.get('user')
  const { search, limit } = c.req.valid('query')
  const includeSystem = currentUser.role === 'admin'
  const wsList = await listWorkspaces(currentUser.sub, { search, limit, includeSystem })
  const tagAssignments = await getTagAssignmentsForUser(currentUser.sub)
  return c.json(
    wsList.map((w) => toApiWorkspace(w, currentUser.username, tagAssignments[w.id] || [])),
    200,
  )
})

const listSessionsRoute = createRoute({
  method: 'get',
  path: '/{id}/sessions',
  tags: ['workspaces'],
  summary: 'List sessions for a workspace',
  security: [{ bearerAuth: [] }],
  request: {
    params: WorkspaceIdParam,
    query: z.object({
      limit: z.coerce.number().int().min(1).max(200).default(20).optional(),
      offset: z.coerce.number().int().min(0).default(0).optional(),
      // When 'true', restrict the list to starred sessions.
      starred: z.enum(['true', 'false']).optional(),
    }),
  },
  responses: {
    200: {
      description: 'Paginated session list',
      content: { 'application/json': { schema: ApiSessionListSchema } },
    },
    404: {
      description: 'Workspace not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

const listMessagesRoute = createRoute({
  method: 'get',
  path: '/{id}/messages',
  tags: ['workspaces'],
  summary: 'List messages for a session within a workspace',
  security: [{ bearerAuth: [] }],
  request: {
    params: WorkspaceIdParam,
    query: z.object({ session_id: z.string() }),
  },
  responses: {
    200: {
      description: 'Messages in chronological order',
      content: { 'application/json': { schema: z.array(ApiMessageSchema) } },
    },
    404: {
      description: 'Workspace not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

read.openapi(listMessagesRoute, async (c) => {
  const currentUser = c.get('user')
  const { id } = c.req.valid('param')
  const { session_id } = c.req.valid('query')
  const workspace = await getWorkspace(id)
  if (!workspace || !canManage(workspace, currentUser)) {
    return c.json({ error: 'Workspace not found' }, 404)
  }
  const messages = await getMessagesWithBlocks(id, session_id)
  return c.json(
    messages.map((m) => ({
      id: String(m.id),
      role: m.role as 'user' | 'assistant',
      content: m.content,
      blocks: m.blocks as any,
      created_at: m.created_at,
      started_at: m.started_at,
      ended_at: m.ended_at,
      duration_ms: m.duration_ms,
    })),
    200,
  )
})

read.openapi(listSessionsRoute, async (c) => {
  const currentUser = c.get('user')
  const { id } = c.req.valid('param')
  const { limit = 20, offset = 0, starred } = c.req.valid('query')
  const workspace = await getWorkspace(id)
  if (!workspace || !canManage(workspace, currentUser)) {
    return c.json({ error: 'Workspace not found' }, 404)
  }
  const { items, total } = await listSessions(id, {
    limit,
    offset,
    starredOnly: starred === 'true',
  })
  return c.json({ items: items.map(toApiSession), total }, 200)
})

read.openapi(getConfigRoute, async (c) => {
  const currentUser = c.get('user')
  const { id } = c.req.valid('param')
  const workspace = await getWorkspace(id)
  if (!workspace || !canManage(workspace, currentUser)) {
    return c.json({ error: 'Workspace not found' }, 404)
  }
  const config = await getWorkspaceConfig(id)
  if (!config) {
    return c.json({ error: 'Config not found' }, 404)
  }
  const attachments = await listAttachmentsForWorkspace(id)
  return c.json(
    {
      agent_type: config.agent_type,
      provider_id: config.provider_id,
      prompt_id: config.prompt_id,
      prompt_name: config.prompt_name,
      prompt_content: config.prompt_content,
      template_id: config.template_id,
      template_version: config.template_version,
      template_name: config.template_name,
      template_latest_version: config.template_latest_version,
      provider_type: config.provider_type,
      model: config.model,
      base_url: config.base_url,
      api_key: '',
      small_model: config.small_model,
      system_prompt: config.system_prompt,
      mcp_config: config.mcp_config,
      agent_settings: config.agent_settings,
      compute_resources: config.compute_resources ?? {},
      auto_start: config.auto_start ?? true,
      user_display_name: currentUser.display_name || currentUser.username || null,
      memory_attachments: attachments.map((a) => ({
        store_id: a.store_id,
        store_name: a.store_name,
        store_description: a.store_description,
        access: a.access,
        instructions: a.instructions,
        // The UI never consumes the index snapshot; only the agent-config path
        // (internal route) bothers fetching it. Keep null here to avoid an
        // extra DB round-trip per attachment.
        index_content: null,
      })),
    },
    200,
  )
})

read.openapi(getStatusRoute, async (c) => {
  const currentUser = c.get('user')
  const { id } = c.req.valid('param')
  const workspace = await getWorkspace(id)
  if (!workspace || !canManage(workspace, currentUser)) {
    return c.json({ error: 'Workspace not found' }, 404)
  }
  try {
    const status = await k8s.getInstanceStatus(workspace.id)
    return c.json(
      {
        deployment: status.deployment.exists
          ? {
              ready: status.deployment.ready,
              replicas: status.deployment.replicas,
              readyReplicas: status.deployment.readyReplicas,
            }
          : null,
        service: status.service.exists ? { ready: true } : null,
        pods: { total: status.pods.total, ready: status.pods.ready },
        warnings: status.warnings,
        conditions: status.conditions,
      },
      200,
    )
  } catch (e: any) {
    console.error('Failed to get K8s status:', e)
    return c.json({ error: 'Failed to get status' }, 500)
  }
})

export default read
