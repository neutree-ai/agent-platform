import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  type ApiModelProvider,
  ApiModelProviderSchema,
  ApiProviderGrantSchema,
  ModelListSchema,
  ModelProviderCreateBodySchema,
  ModelProviderDeleteConflictSchema,
  ModelProviderTestBodySchema,
  ModelProviderTestResultSchema,
  ModelProviderUpdateBodySchema,
  ProviderGrantsBodySchema,
} from '../../../internal/types/api'
import type { AppEnv } from '../lib/types'
import { notifyAgentReload } from '../lib/workspace-address'
import {
  type ProviderWithAccess,
  createModelProvider,
  deleteModelProvider,
  getModelProvider,
  getProviderForUser,
  getRunningWorkspacesByProvider,
  getWorkspacesUsingProvider,
  listProviderGrants,
  listVisibleToUser,
  setProviderGrants,
  updateModelProvider,
} from '../services/db/model-providers'
import { getTeamMembership } from '../services/db/teams'

const providers = new OpenAPIHono<AppEnv>()

const ErrorSchema = z.object({ error: z.string() })
const SuccessSchema = z.object({ success: z.boolean() })

const IdParam = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' } }),
})

function toApi(p: ProviderWithAccess): ApiModelProvider {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    provider_type: p.provider_type,
    base_url: p.base_url,
    api_key: '', // never expose api_key — owner edits via blank-keeps-existing pattern
    user_id: p.user_id,
    owner_name: p.owner_name,
    is_owner: p.is_owner,
    is_public: p.is_public,
    visibility: p.visibility,
    my_permission: p.my_permission,
    shared_via_teams: p.shared_via_teams,
    created_at: p.created_at,
    updated_at: p.updated_at,
  }
}

// Provider team grants are restricted to 'viewer'. Schema admits 'editor' for
// parity with prompt, but routes reject it. See migrations/080 rationale.
async function validateProviderGrants(
  userId: string,
  grants: { team_id: string; permission: 'viewer' | 'editor' }[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  for (const g of grants) {
    if (g.permission !== 'viewer') {
      return { ok: false, error: 'Provider team grants must be viewer' }
    }
    const m = await getTeamMembership(g.team_id, userId)
    if (!m) return { ok: false, error: `Team ${g.team_id} not accessible` }
  }
  return { ok: true }
}

function resolveAnthropicUrl(provider: { provider_type: string; base_url: string }): string {
  if (provider.provider_type === 'claude-code-oauth') return 'https://api.anthropic.com'
  return (provider.base_url || 'https://api.anthropic.com').replace(/\/+$/, '')
}

function isAnthropicType(pt: string): boolean {
  return pt === 'anthropic' || pt === 'anthropic-oauth' || pt === 'claude-code-oauth'
}

// Both OpenAI-family types list models the same way (GET /v1/models); they
// differ only in the chat wire protocol used at runtime and by the test probe:
// `openai` = Responses API (Codex), `openai-chat` = Chat Completions (goose).
function isOpenAIType(pt: string): boolean {
  return pt === 'openai' || pt === 'openai-chat'
}

// ── GET / ──────────────────────────────────────────────────────────────────
const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['providers'],
  summary: 'List providers visible to the user (own + public + team-shared)',
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'List of providers (api_key redacted)',
      content: { 'application/json': { schema: z.array(ApiModelProviderSchema) } },
    },
  },
})

providers.openapi(listRoute, async (c) => {
  const user = c.get('user')
  const list = await listVisibleToUser(user.sub)
  return c.json(list.map(toApi), 200)
})

// ── POST / ─────────────────────────────────────────────────────────────────
const createRouteDef = createRoute({
  method: 'post',
  path: '/',
  tags: ['providers'],
  summary: 'Create a model provider',
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { 'application/json': { schema: ModelProviderCreateBodySchema } } },
  },
  responses: {
    201: {
      description: 'Created provider',
      content: { 'application/json': { schema: ApiModelProviderSchema } },
    },
    400: { description: 'Invalid input', content: { 'application/json': { schema: ErrorSchema } } },
    409: {
      description: 'Name already in use',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

providers.openapi(createRouteDef, async (c) => {
  const user = c.get('user')
  const body = c.req.valid('json')

  // Resolve visibility — prefer explicit, fall back to legacy is_public for
  // old web pods rolling alongside (phase-1 dual-read).
  let visibility = body.visibility
  if (visibility === undefined) {
    visibility = body.is_public ? 'public' : 'private'
  }
  const grants = body.grants ?? []
  if (visibility === 'team' && grants.length === 0) {
    return c.json({ error: 'visibility=team requires at least one grant' }, 400)
  }
  if (visibility !== 'team' && grants.length > 0) {
    return c.json({ error: 'grants only allowed when visibility=team' }, 400)
  }
  const grantCheck = await validateProviderGrants(user.sub, grants)
  if (!grantCheck.ok) return c.json({ error: grantCheck.error }, 400)

  try {
    const provider = await createModelProvider(body.name, {
      description: body.description,
      provider_type: body.provider_type,
      base_url: body.base_url,
      api_key: body.api_key,
      user_id: user.sub,
      visibility,
    })
    if (grants.length > 0) await setProviderGrants(provider.id, grants, user.sub)
    const decorated = await getProviderForUser(provider.id, user.sub)
    return c.json(toApi(decorated!), 201)
  } catch (e) {
    if ((e as { code?: string })?.code === '23505') {
      return c.json({ error: 'A provider with this name already exists' }, 409)
    }
    throw e
  }
})

// ── PUT /:id ───────────────────────────────────────────────────────────────
const updateRouteDef = createRoute({
  method: 'put',
  path: '/{id}',
  tags: ['providers'],
  summary: 'Update a model provider (owner only; empty api_key keeps existing value)',
  security: [{ bearerAuth: [] }],
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: ModelProviderUpdateBodySchema } } },
  },
  responses: {
    200: {
      description: 'Updated provider',
      content: { 'application/json': { schema: ApiModelProviderSchema } },
    },
    400: {
      description: 'Invalid grants for visibility',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorSchema } } },
    404: {
      description: 'Provider not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

providers.openapi(updateRouteDef, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const body = { ...c.req.valid('json') }

  const existing = await getProviderForUser(id, user.sub)
  if (!existing) return c.json({ error: 'Provider not found' }, 404)
  if (!existing.is_owner) return c.json({ error: 'Forbidden' }, 403)

  if (body.api_key !== undefined && !body.api_key) {
    // biome-ignore lint/performance/noDelete: must drop the key, undefined would still be persisted
    delete body.api_key
  }

  // Resolve visibility from body; if absent but is_public present, derive.
  let nextVisibility = body.visibility
  if (nextVisibility === undefined && body.is_public !== undefined) {
    nextVisibility = body.is_public ? 'public' : 'private'
  }
  const effectiveVisibility = nextVisibility ?? existing.visibility
  const nextGrants = body.grants
  if (nextGrants !== undefined) {
    if (effectiveVisibility === 'team' && nextGrants.length === 0) {
      return c.json({ error: 'visibility=team requires at least one grant' }, 400)
    }
    if (effectiveVisibility !== 'team' && nextGrants.length > 0) {
      return c.json({ error: 'grants only allowed when visibility=team' }, 400)
    }
    const grantCheck = await validateProviderGrants(user.sub, nextGrants)
    if (!grantCheck.ok) return c.json({ error: grantCheck.error }, 400)
  } else if (nextVisibility !== undefined && nextVisibility !== 'team') {
    await setProviderGrants(id, [], user.sub)
  }

  const updated = await updateModelProvider(id, {
    name: body.name,
    description: body.description,
    provider_type: body.provider_type,
    base_url: body.base_url,
    api_key: body.api_key,
    visibility: nextVisibility,
  })
  if (!updated) return c.json({ error: 'Provider not found' }, 404)

  if (nextGrants !== undefined) {
    await setProviderGrants(id, nextGrants, user.sub)
  }

  const workspaces = await getRunningWorkspacesByProvider(id)
  for (const ws of workspaces) {
    notifyAgentReload(ws.id, ['config']).catch(() => {})
  }

  const decorated = await getProviderForUser(id, user.sub)
  return c.json(toApi(decorated!), 200)
})

// ── GET /:id/models ────────────────────────────────────────────────────────
const listModelsRoute = createRoute({
  method: 'get',
  path: '/{id}/models',
  tags: ['providers'],
  summary: 'List models available via this provider',
  security: [{ bearerAuth: [] }],
  request: { params: IdParam },
  responses: {
    200: {
      description: 'Model list (may include an error when the upstream call failed)',
      content: { 'application/json': { schema: ModelListSchema } },
    },
    404: {
      description: 'Provider not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

providers.openapi(listModelsRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const decorated = await getProviderForUser(id, user.sub)
  if (!decorated) return c.json({ error: 'Provider not found' }, 404)
  // Need raw row for api_key (decorated has it redacted? actually decorated keeps real key — see decorateProvider)
  const provider = await getModelProvider(id)
  if (!provider) return c.json({ error: 'Provider not found' }, 404)

  try {
    if (isAnthropicType(provider.provider_type)) {
      const baseUrl = resolveAnthropicUrl(provider)
      const res = await fetch(`${baseUrl}/v1/models`, {
        headers: {
          'x-api-key': provider.api_key,
          'anthropic-version': '2023-06-01',
        },
      })
      if (!res.ok) return c.json({ models: [], error: `${res.status} ${res.statusText}` }, 200)
      const data = (await res.json()) as { data?: { id: string; display_name?: string }[] }
      const models = (data.data ?? []).map((m) => ({ id: m.id, name: m.display_name || m.id }))
      return c.json({ models }, 200)
    }

    if (isOpenAIType(provider.provider_type)) {
      // OpenAI model listing lives at `<base>/v1/models`. base_url may or may not
      // already carry the `/v1` suffix: some gateways are configured version-
      // complete (`.../tos-provider/v1`), others as a bare host
      // (`https://proxy.example.com`). Append `/v1` only when it is missing, so
      // both styles resolve to a single `/v1/models` — never `/models` (which a
      // proxy serves its SPA index for → HTML → JSON parse error) and never
      // `/v1/v1/models` (which the gateway 404s).
      const raw = (provider.base_url || 'https://api.openai.com/v1').replace(/\/+$/, '')
      const baseUrl = raw.endsWith('/v1') ? raw : `${raw}/v1`
      const res = await fetch(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${provider.api_key}` },
      })
      if (!res.ok) return c.json({ models: [], error: `${res.status} ${res.statusText}` }, 200)
      const data = (await res.json()) as { data?: { id: string }[] }
      const models = (data.data ?? []).map((m) => ({ id: m.id, name: m.id }))
      return c.json({ models }, 200)
    }

    return c.json(
      { models: [], error: `Unsupported provider type: ${provider.provider_type}` },
      200,
    )
  } catch (e) {
    return c.json({ models: [], error: (e as Error).message || 'Connection failed' }, 200)
  }
})

// ── POST /:id/test ─────────────────────────────────────────────────────────
const testRoute = createRoute({
  method: 'post',
  path: '/{id}/test',
  tags: ['providers'],
  summary: 'Probe the provider with a minimal request',
  security: [{ bearerAuth: [] }],
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: ModelProviderTestBodySchema } } },
  },
  responses: {
    200: {
      description: 'Probe result',
      content: { 'application/json': { schema: ModelProviderTestResultSchema } },
    },
    404: {
      description: 'Provider not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

providers.openapi(testRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const decorated = await getProviderForUser(id, user.sub)
  if (!decorated) return c.json({ error: 'Provider not found' }, 404)
  const provider = await getModelProvider(id)
  if (!provider) return c.json({ error: 'Provider not found' }, 404)

  const body = c.req.valid('json')
  const model = body.model?.trim() || ''

  // A model is mandatory: the probe issues a real completion request, so there
  // is no safe provider-agnostic default to fall back to.
  if (!model) {
    return c.json({ ok: false, detail: 'Select a model to test this provider.' }, 200)
  }

  // Merge optional draft config over the stored provider so the Edit Provider
  // dialog can probe unsaved values. A blank api_key keeps the stored key.
  const effective = {
    provider_type: body.provider_type ?? provider.provider_type,
    base_url: body.base_url ?? provider.base_url,
    api_key: body.api_key ? body.api_key : provider.api_key,
  }

  try {
    let res: Response

    if (isAnthropicType(effective.provider_type)) {
      const baseUrl = resolveAnthropicUrl(effective)
      res = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': effective.api_key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
      })
    } else if (isOpenAIType(effective.provider_type)) {
      // Normalise to a single `/v1` suffix regardless of how base_url is stored
      // (bare host or already version-complete); see the fetch-models handler
      // above for why both `/models` and `/v1/v1/...` are wrong.
      const raw = (effective.base_url || 'https://api.openai.com/v1').replace(/\/+$/, '')
      const baseUrl = raw.endsWith('/v1') ? raw : `${raw}/v1`
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${effective.api_key}`,
      }
      const probeChat = () =>
        fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model,
            max_tokens: 1,
            messages: [{ role: 'user', content: 'hi' }],
          }),
        })

      if (effective.provider_type === 'openai-chat') {
        // Chat Completions only — probe the endpoint goose actually uses.
        res = await probeChat()
      } else {
        // `openai` = Responses API; fall back to Chat Completions for gateways
        // that don't implement /responses.
        res = await fetch(`${baseUrl}/responses`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model,
            input: 'hi',
            max_output_tokens: 1,
          }),
        })

        if (!res.ok) {
          const text = await res.text().catch(() => '')
          if (text.includes('Unsupported') || res.status === 404) {
            res = await probeChat()
          }
        }
      }
    } else {
      return c.json(
        { ok: false, detail: `Unsupported provider type: ${effective.provider_type}` },
        200,
      )
    }

    if (res.ok) return c.json({ ok: true }, 200)
    const text = await res.text().catch(() => '')
    return c.json(
      { ok: false, detail: `${res.status} ${res.statusText}: ${text.slice(0, 200)}` },
      200,
    )
  } catch (e) {
    return c.json({ ok: false, detail: (e as Error).message || 'Connection failed' }, 200)
  }
})

// ── DELETE /:id ────────────────────────────────────────────────────────────
const deleteRouteDef = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['providers'],
  summary: 'Delete a model provider (owner only)',
  security: [{ bearerAuth: [] }],
  request: { params: IdParam },
  responses: {
    200: { description: 'Deleted', content: { 'application/json': { schema: SuccessSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorSchema } } },
    404: {
      description: 'Provider not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    409: {
      description: 'Provider is still referenced by one or more workspaces',
      content: { 'application/json': { schema: ModelProviderDeleteConflictSchema } },
    },
  },
})

providers.openapi(deleteRouteDef, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')

  const existing = await getProviderForUser(id, user.sub)
  if (!existing) return c.json({ error: 'Provider not found' }, 404)
  if (!existing.is_owner) return c.json({ error: 'Forbidden' }, 403)

  const usedBy = await getWorkspacesUsingProvider(id)
  if (usedBy.length > 0) {
    const names = usedBy.map((w) => w.name).join(', ')
    return c.json(
      {
        error: `Provider is in use by agent(s): ${names}. Please remove the reference before deleting.`,
        used_by: usedBy,
      },
      409,
    )
  }

  try {
    await deleteModelProvider(id)
  } catch (e) {
    if ((e as { code?: string })?.code === '23503') {
      return c.json(
        {
          error: 'Provider is in use and cannot be deleted. Please remove references first.',
          used_by: [],
        },
        409,
      )
    }
    throw e
  }
  return c.json({ success: true }, 200)
})

// ── GET /:id/grants ────────────────────────────────────────────────────────
const listGrantsRoute = createRoute({
  method: 'get',
  path: '/{id}/grants',
  tags: ['providers'],
  summary: 'List team grants for a provider (owner only)',
  security: [{ bearerAuth: [] }],
  request: { params: IdParam },
  responses: {
    200: {
      description: 'Grant list',
      content: { 'application/json': { schema: z.array(ApiProviderGrantSchema) } },
    },
    404: {
      description: 'Provider not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

providers.openapi(listGrantsRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const existing = await getProviderForUser(id, user.sub)
  if (!existing || !existing.is_owner) {
    return c.json({ error: 'Provider not found' }, 404)
  }
  const rows = await listProviderGrants(id)
  return c.json(rows, 200)
})

// ── PUT /:id/grants ────────────────────────────────────────────────────────
const setGrantsRoute = createRoute({
  method: 'put',
  path: '/{id}/grants',
  tags: ['providers'],
  summary: 'Replace team grants for a provider (owner only)',
  security: [{ bearerAuth: [] }],
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: ProviderGrantsBodySchema } } },
  },
  responses: {
    200: {
      description: 'Grant list',
      content: { 'application/json': { schema: z.array(ApiProviderGrantSchema) } },
    },
    400: {
      description: 'Invalid grants',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Provider not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

providers.openapi(setGrantsRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const existing = await getProviderForUser(id, user.sub)
  if (!existing || !existing.is_owner) {
    return c.json({ error: 'Provider not found' }, 404)
  }
  const { grants } = c.req.valid('json')
  if (existing.visibility !== 'team' && grants.length > 0) {
    return c.json({ error: 'grants only allowed when visibility=team' }, 400)
  }
  const grantCheck = await validateProviderGrants(user.sub, grants)
  if (!grantCheck.ok) return c.json({ error: grantCheck.error }, 400)

  await setProviderGrants(id, grants, user.sub)
  const rows = await listProviderGrants(id)
  return c.json(rows, 200)
})

export default providers
