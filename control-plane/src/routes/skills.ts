/**
 * /api/skills — thin HTTP shell for the p3 id-keyed skills surface.
 *
 * Handlers parse the request, call the singleton `skillsService`, map known
 * service errors to declared HTTP statuses, and serialize. All authorization,
 * size validation, visibility/grants logic, and scs orchestration live in
 * SkillsService. Streaming endpoints pipe `c.req.raw.body` straight through
 * to scs (via service helpers) — cp never materializes the tarball.
 *
 * p3 surface highlights:
 *   - Skills are addressed by UUID `id` (was: by `name`).
 *   - Sources are first-class (`/sources/...`); native + git share the
 *     same shape.
 *   - Versions are first-class (`/:id/versions`, `/:id/publish`,
 *     `/:id/active-version`).
 */
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  type ApiSkill,
  ApiSkillGrantSchema,
  ApiSkillSchema,
  type ApiSkillSource,
  ApiSkillSourceSchema,
  type ApiSkillVersion,
  ApiSkillVersionSchema,
  SkillActiveVersionBodySchema,
  SkillCreateNativeBodySchema,
  SkillDependentsSchema,
  SkillFromGitErrorSchema,
  SkillGrantsBodySchema,
  SkillImportFromGitBodySchema,
  SkillPatchBodySchema,
  SkillPublishBodySchema,
  SkillScanCandidateSchema,
  SkillScanGitBodySchema,
  SkillScanResponseSchema,
  SkillSwitchToGitBodySchema,
  SkillSyncBodySchema,
  SkillSyncResponseSchema,
  SourcePatchBodySchema,
} from '../../../internal/types/api'
import type { AppEnv } from '../lib/types'
import { getUserCredentialValue } from '../services/db/credentials'
import type { SkillMeta, SkillSource, SkillVersion } from '../services/db/types'
import type { SkillWithAccess } from '../services/skill-repository'
import { skillsService } from '../services/skills-composition'
import {
  scsDraftFileUrl,
  scsPatchSource,
  skillsContentFetch,
  skillsContentUrl,
} from '../services/skills-content'
import {
  ConflictError,
  InvalidInputError,
  MAX_SKILL_PACKAGE_BYTES,
  NotAllowedError,
  SkillNotFoundError,
} from '../services/skills-errors'

const skills = new OpenAPIHono<AppEnv>()

const ErrorSchema = z.object({ error: z.string() })

const IdParam = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' } }),
})

const SkillVersionIdParam = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' } }),
  vid: z.string().openapi({ param: { name: 'vid', in: 'path' } }),
})

function tooLargeMessage(byteLength: number): string {
  return `Skill package too large: ${(byteLength / 1024 / 1024).toFixed(1)} MB exceeds ${MAX_SKILL_PACKAGE_BYTES / 1024 / 1024} MB limit`
}

// ── serialization helpers ─────────────────────────────────────────────────

function skillWithAccessToApi(s: SkillWithAccess): ApiSkill {
  return {
    id: s.id,
    source_id: s.source_id,
    source_kind: s.source_kind,
    active_version_id: s.active_version_id,
    name: s.name,
    subpath: s.subpath,
    description: s.description,
    user_id: s.user_id,
    is_public: s.is_public,
    visibility: s.visibility,
    my_permission: s.my_permission,
    shared_via_teams: s.shared_via_teams,
    owner_name: s.owner_name ?? '',
    is_own: s.is_owner,
    category: s.category,
    created_at: s.created_at,
    updated_at: s.updated_at,
  }
}

/**
 * Translate a `SkillMeta` returned from scs (newly created in this request)
 * to the user-facing `ApiSkill` shape. We know the caller is the owner
 * because they just created it, so access fields are filled in statically.
 */
function ownerSkillMetaToApi(s: SkillMeta): ApiSkill {
  return {
    id: s.id,
    source_id: s.source_id,
    source_kind: s.source_kind,
    active_version_id: s.active_version_id,
    name: s.name,
    subpath: s.subpath,
    description: s.description,
    user_id: s.user_id,
    is_public: s.is_public,
    visibility: s.visibility,
    my_permission: 'owner',
    shared_via_teams: [],
    owner_name: s.owner_name ?? '',
    is_own: true,
    category: s.category,
    created_at: s.created_at,
    updated_at: s.updated_at,
  }
}

function sourceToApi(s: SkillSource): ApiSkillSource {
  return {
    id: s.id,
    user_id: s.user_id,
    kind: s.kind,
    git_type: s.git_type,
    git_url: s.git_url,
    git_host: s.git_host,
    git_owner: s.git_owner,
    git_repo: s.git_repo,
    git_ref: s.git_ref,
    credential_name: s.credential_name,
    last_commit_sha: s.last_commit_sha,
    last_synced_at: s.last_synced_at,
    has_draft: s.has_draft,
    skill_count: s.skill_count,
    created_at: s.created_at,
    updated_at: s.updated_at,
  }
}

function versionToApi(v: SkillVersion): ApiSkillVersion {
  return {
    id: v.id,
    skill_id: v.skill_id,
    source_id: v.source_id,
    content_hash: v.content_hash,
    commit_sha: v.commit_sha,
    note: v.note,
    published_at: v.published_at,
    published_by: v.published_by,
  }
}

// ── error-mapping ─────────────────────────────────────────────────────────
//
// Per-router onError: handlers `throw` typed service errors and we translate
// here. Keeping it on the router (not inside each handler) keeps the typed-
// response inference of zod-openapi clean — handlers only declare success
// paths and the framework treats thrown errors uniformly.
skills.onError((err, c) => {
  if (err instanceof SkillNotFoundError) return c.json({ error: err.message }, 404)
  if (err instanceof NotAllowedError) return c.json({ error: err.message }, 403)
  if (err instanceof InvalidInputError) return c.json({ error: err.message }, 400)
  if (err instanceof ConflictError) return c.json({ error: err.message }, 409)
  console.error('[skills] unexpected error:', err.message)
  return c.json({ error: err.message }, 502)
})

const PASSTHROUGH = [
  'Content-Type',
  'Content-Disposition',
  'Content-Length',
  'ETag',
  'Last-Modified',
]

async function proxyScsBinary(
  c: Parameters<Parameters<typeof skills.openapi>[1]>[0],
  url: string,
  defaultContentType?: string,
): Promise<Response> {
  // Forward conditional headers so dufs can answer 304 — keeps revalidation
  // cheap under our `Cache-Control: no-cache` policy below.
  const fwd: Record<string, string> = {}
  const ifNoneMatch = c.req.header('If-None-Match')
  const ifModSince = c.req.header('If-Modified-Since')
  if (ifNoneMatch) fwd['If-None-Match'] = ifNoneMatch
  if (ifModSince) fwd['If-Modified-Since'] = ifModSince
  const result = await skillsContentFetch(url, c.req.raw.signal, fwd)
  if (!result.ok) return c.json({ error: result.error }, 502)
  const { response } = result
  // 304 is not response.ok in fetch — handle before the generic !ok branch.
  if (response.status === 304) {
    const headers = new Headers()
    for (const h of PASSTHROUGH) {
      const v = response.headers.get(h)
      if (v) headers.set(h, v)
    }
    headers.set('Cache-Control', 'no-cache')
    return new Response(null, { status: 304, headers })
  }
  if (response.status === 404) return c.json({ error: 'Not found' }, 404)
  if (!response.ok) return c.json({ error: `Upstream returned ${response.status}` }, 502)
  const headers = new Headers()
  for (const h of PASSTHROUGH) {
    const v = response.headers.get(h)
    if (v) headers.set(h, v)
  }
  if (defaultContentType && !headers.has('Content-Type')) {
    headers.set('Content-Type', defaultContentType)
  }
  // Force the browser to revalidate on every access — content can change
  // when the skill's active version flips and we can't actively invalidate
  // client caches. ETag/Last-Modified survive in PASSTHROUGH so a 304 is
  // still cheap.
  headers.set('Cache-Control', 'no-cache')
  return new Response(response.body, { status: response.status, headers })
}

// ── GET / ─────────────────────────────────────────────────────────────────
const listQuery = z.object({
  q: z
    .string()
    .optional()
    .openapi({
      param: { name: 'q', in: 'query' },
      description: 'Case-insensitive substring match on name + description.',
    }),
  owner: z
    .string()
    .optional()
    .openapi({
      param: { name: 'owner', in: 'query' },
      description: 'Filter to skills whose owner is this user id.',
    }),
  category: z
    .string()
    .optional()
    .openapi({
      param: { name: 'category', in: 'query' },
      description:
        'Comma-separated list of categories (OR semantics). Pass the literal "uncategorized" to include skills with no category set.',
    }),
  visibility: z
    .enum(['private', 'team', 'public'])
    .optional()
    .openapi({
      param: { name: 'visibility', in: 'query' },
      description: 'Restrict to skills with this visibility.',
    }),
})

const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['skills'],
  summary: 'List skills visible to the user (own + public + team-shared)',
  security: [{ bearerAuth: [] }],
  request: { query: listQuery },
  responses: {
    200: {
      description: 'Skill list',
      content: { 'application/json': { schema: z.array(ApiSkillSchema) } },
    },
  },
})

skills.openapi(listRoute, async (c) => {
  const user = c.get('user')
  const { q, owner, category, visibility } = c.req.valid('query')
  const categories = category
    ? category
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined
  const list = await skillsService.list(user.sub, {
    query: q,
    ownerId: owner,
    categories,
    visibility,
  })
  return c.json(list.map(skillWithAccessToApi), 200)
})

// ── POST /scan-git ────────────────────────────────────────────────────────
const scanGitRoute = createRoute({
  method: 'post',
  path: '/scan-git',
  tags: ['skills'],
  summary: 'List skill candidates in a git repo without persisting',
  security: [{ bearerAuth: [] }],
  request: { body: { content: { 'application/json': { schema: SkillScanGitBodySchema } } } },
  responses: {
    200: {
      description: 'Skill candidates',
      content: { 'application/json': { schema: SkillScanResponseSchema } },
    },
    400: {
      description: 'Invalid git URL',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Credential not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    502: {
      description: 'Upstream fetch failed',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

skills.openapi(scanGitRoute, async (c) => {
  const user = c.get('user')
  const body = c.req.valid('json')

  let token = body.token
  if (!token && body.credential_name) {
    const resolved = await getUserCredentialValue(user.sub, body.credential_name)
    if (!resolved) {
      return c.json({ error: `Credential "${body.credential_name}" not found` }, 404)
    }
    token = resolved
  }
  const value = await skillsService.scanGit(user.sub, {
    userId: user.sub,
    url: body.url,
    type: body.type,
    ref: body.ref,
    token,
  })
  return c.json(value, 200)
})

// ── POST /scan-tarball ────────────────────────────────────────────────────
const scanTarballRoute = createRoute({
  method: 'post',
  path: '/scan-tarball',
  tags: ['skills'],
  summary: 'List skill candidates inside an uploaded tarball without persisting',
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Skill candidates',
      content: {
        'application/json': { schema: z.object({ candidates: z.array(SkillScanCandidateSchema) }) },
      },
    },
    400: {
      description: 'Empty body or invalid tarball',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    413: {
      description: 'Body exceeds size limit',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    502: {
      description: 'skills-content-service unavailable',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

skills.openapi(scanTarballRoute, async (c) => {
  const user = c.get('user')
  const declaredLength = Number(c.req.header('content-length') || 0)
  if (declaredLength > MAX_SKILL_PACKAGE_BYTES) {
    return c.json({ error: tooLargeMessage(declaredLength) }, 413)
  }
  const body = c.req.raw.body
  if (!body) return c.json({ error: 'Empty body' }, 400)
  const value = await skillsService.scanTarball({
    userId: user.sub,
    body: body as ReadableStream<Uint8Array>,
    contentLength: declaredLength || undefined,
    signal: c.req.raw.signal,
  })
  return c.json(value, 200)
})

// ── POST / (binary upload) ────────────────────────────────────────────────
const uploadQuery = z.object({
  name: z
    .string()
    .min(1)
    .openapi({ param: { name: 'name', in: 'query' } }),
  description: z
    .string()
    .optional()
    .openapi({ param: { name: 'description', in: 'query' } }),
  visibility: z
    .enum(['private', 'team', 'public'])
    .optional()
    .openapi({ param: { name: 'visibility', in: 'query' } }),
  category: z
    .string()
    .optional()
    .openapi({ param: { name: 'category', in: 'query' } }),
})

const uploadRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['skills'],
  summary: 'Upload a skill package (tar.gz). Metadata goes in query params.',
  security: [{ bearerAuth: [] }],
  request: { query: uploadQuery },
  responses: {
    201: {
      description: 'New skill created',
      content: { 'application/json': { schema: ApiSkillSchema } },
    },
    400: { description: 'Empty body', content: { 'application/json': { schema: ErrorSchema } } },
    413: {
      description: 'Package exceeds size limit',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    502: {
      description: 'skills-content-service unavailable',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

skills.openapi(uploadRoute, async (c) => {
  const user = c.get('user')
  const { name, description, visibility, category } = c.req.valid('query')

  const declaredLength = Number(c.req.header('content-length') || 0)
  if (declaredLength > MAX_SKILL_PACKAGE_BYTES) {
    return c.json({ error: tooLargeMessage(declaredLength) }, 413)
  }

  const body = c.req.raw.body
  if (!body) return c.json({ error: 'Empty body' }, 400)
  const { skill } = await skillsService.uploadSkill({
    userId: user.sub,
    name,
    description: description ?? '',
    visibility: visibility ?? 'private',
    category: category ?? null,
    body: body as ReadableStream<Uint8Array>,
    contentLength: declaredLength || undefined,
    signal: c.req.raw.signal,
  })
  return c.json(ownerSkillMetaToApi(skill), 201)
})

// ── POST /from-git ────────────────────────────────────────────────────────
const fromGitRoute = createRoute({
  method: 'post',
  path: '/from-git',
  tags: ['skills'],
  summary: 'Import a single subpath from a git repo as a new skill',
  security: [{ bearerAuth: [] }],
  request: { body: { content: { 'application/json': { schema: SkillImportFromGitBodySchema } } } },
  responses: {
    201: {
      description: 'New skill created',
      content: { 'application/json': { schema: ApiSkillSchema } },
    },
    400: {
      description:
        'Invalid input — or repo had multiple skill candidates and no subpath was specified (response includes `candidates`)',
      content: { 'application/json': { schema: SkillFromGitErrorSchema } },
    },
    404: {
      description: 'Credential not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    502: {
      description: 'Upstream fetch failed',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

skills.openapi(fromGitRoute, async (c) => {
  const user = c.get('user')
  const body = c.req.valid('json')

  let token = body.token
  if (!token && body.credential_name) {
    const resolved = await getUserCredentialValue(user.sub, body.credential_name)
    if (!resolved) {
      return c.json({ error: `Credential "${body.credential_name}" not found` }, 404)
    }
    token = resolved
  }

  try {
    const { skill } = await skillsService.importFromGit({
      userId: user.sub,
      url: body.url,
      type: body.type,
      ref: body.ref,
      token,
      credentialName: body.credential_name ?? null,
      subpath: body.subpath,
      name: body.name,
      description: body.description,
      visibility: body.visibility ?? 'private',
      category: body.category ?? null,
    })
    return c.json(ownerSkillMetaToApi(skill), 201)
  } catch (e) {
    // Multi-candidate repos surface as InvalidInputError with a `candidates`
    // payload preserved from scs. Forward so the web picker can render
    // without re-fetching the tarball. (/scan-git is the recommended
    // primary path; this is the legacy short-circuit.)
    if (e instanceof InvalidInputError) {
      const candidates = e.details?.candidates
      if (Array.isArray(candidates)) {
        return c.json({ error: e.message, candidates }, 400)
      }
      return c.json({ error: e.message }, 400)
    }
    throw e
  }
})

// ── POST /{id}/switch-to-git ──────────────────────────────────────────────
const switchToGitRoute = createRoute({
  method: 'post',
  path: '/{id}/switch-to-git',
  tags: ['skills'],
  summary: 'Switch a native skill to a git source in place (wipes native history)',
  security: [{ bearerAuth: [] }],
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: SkillSwitchToGitBodySchema } } },
  },
  responses: {
    200: {
      description: 'Skill switched to git source',
      content: { 'application/json': { schema: ApiSkillSchema } },
    },
    400: {
      description: 'Invalid input — bad repo / subpath / no SKILL.md',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Skill or credential not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    409: {
      description: 'Skill is not native, or subpath is taken by another skill',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    502: {
      description: 'Upstream fetch failed',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

skills.openapi(switchToGitRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const body = c.req.valid('json')

  let token = body.token
  if (!token && body.credential_name) {
    const resolved = await getUserCredentialValue(user.sub, body.credential_name)
    if (!resolved) {
      return c.json({ error: `Credential "${body.credential_name}" not found` }, 404)
    }
    token = resolved
  }

  const { skill } = await skillsService.switchSkillToGit({
    userId: user.sub,
    skillId: id,
    url: body.url,
    type: body.type,
    ref: body.ref,
    token,
    credentialName: body.credential_name ?? null,
    subpath: body.subpath,
  })
  return c.json(ownerSkillMetaToApi(skill), 200)
})

// ── POST /sources/native ──────────────────────────────────────────────────
const createNativeSourceRoute = createRoute({
  method: 'post',
  path: '/sources/native',
  tags: ['skills'],
  summary: 'Create a native (in-NAP authored) source + initial empty skill',
  security: [{ bearerAuth: [] }],
  request: { body: { content: { 'application/json': { schema: SkillCreateNativeBodySchema } } } },
  responses: {
    201: {
      description: 'Source + skill created',
      content: {
        'application/json': {
          schema: z.object({ source: ApiSkillSourceSchema, skill: ApiSkillSchema }),
        },
      },
    },
    400: { description: 'Invalid input', content: { 'application/json': { schema: ErrorSchema } } },
    502: {
      description: 'skills-content-service unavailable',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

skills.openapi(createNativeSourceRoute, async (c) => {
  const user = c.get('user')
  const body = c.req.valid('json')
  const { source, skill } = await skillsService.createNativeSource({
    userId: user.sub,
    name: body.name,
    description: body.description,
    visibility: body.visibility,
    category: body.category ?? null,
  })
  return c.json({ source: sourceToApi(source), skill: ownerSkillMetaToApi(skill) }, 201)
})

// ── GET /sources ──────────────────────────────────────────────────────────
const listSourcesQuery = z.object({
  kind: z
    .enum(['git', 'native'])
    .optional()
    .openapi({ param: { name: 'kind', in: 'query' } }),
})

const listSourcesRoute = createRoute({
  method: 'get',
  path: '/sources',
  tags: ['skills'],
  summary: 'List sources owned by the caller',
  security: [{ bearerAuth: [] }],
  request: { query: listSourcesQuery },
  responses: {
    200: {
      description: 'Source list',
      content: { 'application/json': { schema: z.array(ApiSkillSourceSchema) } },
    },
  },
})

skills.openapi(listSourcesRoute, async (c) => {
  const user = c.get('user')
  const { kind } = c.req.valid('query')
  const sources = await skillsService.listSources(user.sub, kind)
  return c.json(sources.map(sourceToApi), 200)
})

// ── GET /sources/:id ──────────────────────────────────────────────────────
const getSourceRoute = createRoute({
  method: 'get',
  path: '/sources/{id}',
  tags: ['skills'],
  summary: 'Read one source by id',
  security: [{ bearerAuth: [] }],
  request: { params: IdParam },
  responses: {
    200: {
      description: 'Source',
      content: { 'application/json': { schema: ApiSkillSourceSchema } },
    },
    404: {
      description: 'Source not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

skills.openapi(getSourceRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const source = await skillsService.getSource(user.sub, id)
  return c.json(sourceToApi(source), 200)
})

// ── GET /sources/:id/skills ───────────────────────────────────────────────
const listSourceSkillsRoute = createRoute({
  method: 'get',
  path: '/sources/{id}/skills',
  tags: ['skills'],
  summary: 'List skills derived from this source',
  security: [{ bearerAuth: [] }],
  request: { params: IdParam },
  responses: {
    200: {
      description: 'Skill list',
      content: { 'application/json': { schema: z.array(ApiSkillSchema) } },
    },
    404: {
      description: 'Source not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

skills.openapi(listSourceSkillsRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const list = await skillsService.listSkillsForSource(user.sub, id)
  // Caller owns the source, so they own every derived skill — fill access
  // fields statically rather than re-querying with the visibility join.
  return c.json(list.map(ownerSkillMetaToApi), 200)
})

// ── PATCH /sources/:id ────────────────────────────────────────────────────
//
// No SkillsService method yet — read source to authorize, then call scs
// directly. Writes here are rare (credential rotation, ref change) and
// trivial enough that pushing them through the service adds no value.
const patchSourceRoute = createRoute({
  method: 'patch',
  path: '/sources/{id}',
  tags: ['skills'],
  summary: 'Update source metadata (owner only)',
  security: [{ bearerAuth: [] }],
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: SourcePatchBodySchema } } },
  },
  responses: {
    200: {
      description: 'Updated source',
      content: { 'application/json': { schema: ApiSkillSourceSchema } },
    },
    400: { description: 'Invalid input', content: { 'application/json': { schema: ErrorSchema } } },
    404: {
      description: 'Source not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    502: {
      description: 'skills-content-service unavailable',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

skills.openapi(patchSourceRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const body = c.req.valid('json')

  // Ownership gate via the service (throws SkillNotFoundError on miss,
  // surfaces through router onError as 404).
  await skillsService.getSource(user.sub, id)

  const result = await scsPatchSource(id, {
    credential_name: body.credential_name,
    git_ref: body.git_ref,
  })
  if (!result.ok) {
    if (result.status === 404) return c.json({ error: result.error }, 404)
    if (result.status === 400) return c.json({ error: result.error }, 400)
    return c.json({ error: result.error }, 502)
  }
  return c.json(sourceToApi(result.value.source), 200)
})

// ── DELETE /sources/:id ───────────────────────────────────────────────────
const deleteSourceRoute = createRoute({
  method: 'delete',
  path: '/sources/{id}',
  tags: ['skills'],
  summary: 'Delete a source (owner only); fails if any skill still under it',
  security: [{ bearerAuth: [] }],
  request: { params: IdParam },
  responses: {
    204: { description: 'Deleted' },
    404: {
      description: 'Source not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    409: {
      description: 'Source still has skills',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

skills.openapi(deleteSourceRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  await skillsService.removeSource(user.sub, id)
  return c.body(null, 204)
})

// ── POST /sources/:id/sync ────────────────────────────────────────────────
const syncSourceRoute = createRoute({
  method: 'post',
  path: '/sources/{id}/sync',
  tags: ['skills'],
  summary: 'Re-fetch a git source; create new versions for changed skills',
  security: [{ bearerAuth: [] }],
  request: {
    params: IdParam,
    body: { required: false, content: { 'application/json': { schema: SkillSyncBodySchema } } },
  },
  responses: {
    200: {
      description: 'Sync result (per-skill change flags)',
      content: { 'application/json': { schema: SkillSyncResponseSchema } },
    },
    400: {
      description: 'Source is not a git source',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Source not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    502: {
      description: 'Upstream fetch failed',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

skills.openapi(syncSourceRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const body: z.infer<typeof SkillSyncBodySchema> = await c.req.json().catch(() => ({}))

  // Resolve credential → token. Falls back to the source's stored
  // credential when the request omits one (matches pre-p3 behavior).
  let token = body.token
  if (!token) {
    const source = await skillsService.getSource(user.sub, id)
    const credName = body.credential_name ?? source.credential_name ?? undefined
    if (credName) {
      const resolved = await getUserCredentialValue(user.sub, credName)
      if (resolved) token = resolved
    }
  }
  const value = await skillsService.syncSource(user.sub, id, token)
  return c.json(
    {
      source: sourceToApi(value.source),
      results: value.results,
      commit_sha: value.commit_sha,
    },
    200,
  )
})

// ── PUT /sources/:id/draft ────────────────────────────────────────────────
const putDraftRoute = createRoute({
  method: 'put',
  path: '/sources/{id}/draft',
  tags: ['skills'],
  summary: 'Save the native source draft (tar.gz body)',
  security: [{ bearerAuth: [] }],
  request: { params: IdParam },
  responses: {
    200: {
      description: 'Draft stored',
      content: {
        'application/json': { schema: z.object({ ok: z.literal(true), byte_count: z.number() }) },
      },
    },
    400: {
      description: 'Empty body or non-native source',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Source not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    413: {
      description: 'Draft exceeds size limit',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    502: {
      description: 'skills-content-service unavailable',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

skills.openapi(putDraftRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')

  const declaredLength = Number(c.req.header('content-length') || 0)
  if (declaredLength > MAX_SKILL_PACKAGE_BYTES) {
    return c.json({ error: tooLargeMessage(declaredLength) }, 413)
  }
  const body = c.req.raw.body
  if (!body) return c.json({ error: 'Empty body' }, 400)
  const value = await skillsService.saveDraft({
    userId: user.sub,
    sourceId: id,
    body: body as ReadableStream<Uint8Array>,
    contentLength: declaredLength || undefined,
    signal: c.req.raw.signal,
  })
  return c.json(value, 200)
})

// ── DELETE /sources/:id/draft ─────────────────────────────────────────────
const deleteDraftRoute = createRoute({
  method: 'delete',
  path: '/sources/{id}/draft',
  tags: ['skills'],
  summary: 'Discard the native source draft',
  security: [{ bearerAuth: [] }],
  request: { params: IdParam },
  responses: {
    204: { description: 'Discarded' },
    404: {
      description: 'Source not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

skills.openapi(deleteDraftRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  await skillsService.discardDraft(user.sub, id)
  return c.body(null, 204)
})

// ── per-file draft editing (native sources, Library editor) ───────────────

const DraftFileQuery = z.object({ path: z.string().min(1) })
const DraftFileNodeSchema = z.object({
  path: z.string(),
  type: z.enum(['file', 'dir']),
  size: z.number().optional(),
})

const listDraftFilesRoute = createRoute({
  method: 'get',
  path: '/sources/{id}/draft/files',
  tags: ['skills'],
  summary: 'List the source draft scratch tree',
  security: [{ bearerAuth: [] }],
  request: { params: IdParam },
  responses: {
    200: {
      description: 'Tree',
      content: {
        'application/json': { schema: z.object({ entries: z.array(DraftFileNodeSchema) }) },
      },
    },
    404: {
      description: 'Source not found / not writable',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

skills.openapi(listDraftFilesRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const entries = await skillsService.listDraftFiles(user.sub, id)
  return c.json({ entries }, 200)
})

const readDraftFileRoute = createRoute({
  method: 'get',
  path: '/sources/{id}/draft/file',
  tags: ['skills'],
  summary: 'Read a single draft file',
  security: [{ bearerAuth: [] }],
  request: { params: IdParam, query: DraftFileQuery },
  responses: {
    200: {
      description: 'File',
      content: { 'application/octet-stream': { schema: z.unknown() } },
    },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    502: { description: 'Upstream', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

skills.openapi(readDraftFileRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const { path } = c.req.valid('query')
  // ACL gate via the service before binary passthrough.
  await skillsService.listDraftFiles(user.sub, id)
  return proxyScsBinary(c, scsDraftFileUrl(id, path), 'application/octet-stream')
})

const MAX_DRAFT_FILE_BYTES = 5 * 1024 * 1024

const writeDraftFileRoute = createRoute({
  method: 'put',
  path: '/sources/{id}/draft/file',
  tags: ['skills'],
  summary: 'Write a single draft file',
  security: [{ bearerAuth: [] }],
  request: { params: IdParam, query: DraftFileQuery },
  responses: {
    200: {
      description: 'Saved',
      content: {
        'application/json': { schema: z.object({ ok: z.literal(true), byte_count: z.number() }) },
      },
    },
    400: {
      description: 'Bad path or empty body',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Source not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    413: { description: 'Too large', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

skills.openapi(writeDraftFileRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const { path } = c.req.valid('query')
  const declaredLength = Number(c.req.header('content-length') || 0)
  if (declaredLength > MAX_DRAFT_FILE_BYTES) {
    return c.json({ error: `File too large: ${declaredLength} bytes` }, 413)
  }
  const body = c.req.raw.body
  if (!body) return c.json({ error: 'Empty body' }, 400)
  const result = await skillsService.writeDraftFile({
    userId: user.sub,
    sourceId: id,
    path,
    body: body as ReadableStream<Uint8Array>,
    contentLength: declaredLength || undefined,
    signal: c.req.raw.signal,
  })
  return c.json(result, 200)
})

const deleteDraftFileRoute = createRoute({
  method: 'delete',
  path: '/sources/{id}/draft/file',
  tags: ['skills'],
  summary: 'Delete a single draft file',
  security: [{ bearerAuth: [] }],
  request: { params: IdParam, query: DraftFileQuery },
  responses: {
    204: { description: 'Deleted' },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

skills.openapi(deleteDraftFileRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const { path } = c.req.valid('query')
  await skillsService.deleteDraftFile(user.sub, id, path)
  return c.body(null, 204)
})

// ── GET /:id ──────────────────────────────────────────────────────────────
const getSkillRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['skills'],
  summary: 'Read one skill by id (visibility-gated)',
  security: [{ bearerAuth: [] }],
  request: { params: IdParam },
  responses: {
    200: { description: 'Skill', content: { 'application/json': { schema: ApiSkillSchema } } },
    404: {
      description: 'Skill not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

skills.openapi(getSkillRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const skill = await skillsService.getSkill(user.sub, id)
  return c.json(skillWithAccessToApi(skill), 200)
})

// ── PATCH /:id ────────────────────────────────────────────────────────────
const patchSkillRoute = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['skills'],
  summary: 'Update skill metadata. Owner: anything. Editor: description only.',
  security: [{ bearerAuth: [] }],
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: SkillPatchBodySchema } } },
  },
  responses: {
    200: {
      description: 'Updated skill',
      content: { 'application/json': { schema: ApiSkillSchema } },
    },
    400: { description: 'Invalid input', content: { 'application/json': { schema: ErrorSchema } } },
    403: { description: 'Not allowed', content: { 'application/json': { schema: ErrorSchema } } },
    404: {
      description: 'Skill not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    409: {
      description: 'Cannot unpublish while other users still reference it',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

skills.openapi(patchSkillRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const body = c.req.valid('json')
  const updated = await skillsService.patchMeta({
    userId: user.sub,
    skillId: id,
    name: body.name,
    description: body.description,
    visibility: body.visibility,
    grants: body.grants,
    category: body.category,
  })
  return c.json(skillWithAccessToApi(updated), 200)
})

// ── DELETE /:id ───────────────────────────────────────────────────────────
const deleteSkillRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['skills'],
  summary: 'Delete a skill (owner only). Fails if still attached anywhere.',
  security: [{ bearerAuth: [] }],
  request: { params: IdParam },
  responses: {
    204: { description: 'Deleted' },
    403: { description: 'Not allowed', content: { 'application/json': { schema: ErrorSchema } } },
    404: {
      description: 'Skill not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    409: { description: 'Still in use', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

skills.openapi(deleteSkillRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  await skillsService.remove(user.sub, id)
  return c.body(null, 204)
})

// ── GET /:id/dependents ───────────────────────────────────────────────────
// Owner-only occupancy preview for the delete / visibility-narrow flows.
const skillDependentsRoute = createRoute({
  method: 'get',
  path: '/{id}/dependents',
  tags: ['skills'],
  summary: 'Workspaces / template versions using this skill (owner only)',
  security: [{ bearerAuth: [] }],
  request: { params: IdParam },
  responses: {
    200: {
      description: 'Occupancy preview',
      content: { 'application/json': { schema: SkillDependentsSchema } },
    },
    403: { description: 'Not allowed', content: { 'application/json': { schema: ErrorSchema } } },
    404: {
      description: 'Skill not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

skills.openapi(skillDependentsRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const dependents = await skillsService.getDependents(user.sub, id)
  return c.json(dependents, 200)
})

// ── GET /:id/package | /:id/files | /:id/dirs | /:id/dirs/zip ─────────────
//
// Visibility-gated proxies to scs. The ACL check is `service.getSkill`; the
// upstream service is internal-network only and trusts the cp gate.

async function ensureSkillVisible(userId: string, id: string): Promise<true | 404> {
  try {
    await skillsService.getSkill(userId, id)
    return true
  } catch (e) {
    if (e instanceof SkillNotFoundError) return 404
    throw e
  }
}

const BinarySchema = z.unknown().openapi({ type: 'string', format: 'binary' })

const packageRoute = createRoute({
  method: 'get',
  path: '/{id}/package',
  tags: ['skills'],
  summary: "Download the skill's active-version tar.gz package",
  security: [{ bearerAuth: [] }],
  request: { params: IdParam },
  responses: {
    200: {
      description: 'Skill package',
      content: { 'application/gzip': { schema: BinarySchema } },
    },
    404: {
      description: 'Skill not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

skills.openapi(packageRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const ok = await ensureSkillVisible(user.sub, id)
  if (ok === 404) return c.json({ error: 'Skill not found' }, 404)
  return proxyScsBinary(c, skillsContentUrl(id, '/package'))
})

const PathQuery = z.object({
  path: z
    .string()
    .default('/')
    .openapi({ param: { name: 'path', in: 'query' } }),
  version: z
    .string()
    .optional()
    .openapi({ param: { name: 'version', in: 'query' } }),
})

const SearchQuery = z.object({
  path: z
    .string()
    .default('/')
    .openapi({ param: { name: 'path', in: 'query' } }),
  q: z
    .string()
    .optional()
    .openapi({ param: { name: 'q', in: 'query' } }),
  version: z
    .string()
    .optional()
    .openapi({ param: { name: 'version', in: 'query' } }),
})

const filesRoute = createRoute({
  method: 'get',
  path: '/{id}/files',
  tags: ['skills'],
  summary: 'Read a file from the skill package (visibility-gated)',
  security: [{ bearerAuth: [] }],
  request: { params: IdParam, query: PathQuery },
  responses: {
    200: {
      description: 'File contents',
      content: { 'application/octet-stream': { schema: BinarySchema } },
    },
    404: {
      description: 'Skill or file not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    502: {
      description: 'Upstream unavailable',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

skills.openapi(filesRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const { path, version } = c.req.valid('query')
  const ok = await ensureSkillVisible(user.sub, id)
  if (ok === 404) return c.json({ error: 'Skill not found' }, 404)
  const qs = new URLSearchParams({ path })
  if (version) qs.set('version', version)
  return proxyScsBinary(c, skillsContentUrl(id, '/files', `?${qs.toString()}`))
})

const dirsRoute = createRoute({
  method: 'get',
  path: '/{id}/dirs',
  tags: ['skills'],
  summary: 'List directory entries inside a skill package (visibility-gated)',
  security: [{ bearerAuth: [] }],
  request: { params: IdParam, query: SearchQuery },
  responses: {
    200: {
      description: 'Directory entries',
      content: { 'application/json': { schema: z.object({ entries: z.array(z.any()) }) } },
    },
    404: {
      description: 'Skill or directory not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    502: {
      description: 'Upstream unavailable',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

skills.openapi(dirsRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const { path, q, version } = c.req.valid('query')
  const ok = await ensureSkillVisible(user.sub, id)
  if (ok === 404) return c.json({ error: 'Skill not found' }, 404)
  const qs = new URLSearchParams({ path })
  if (q) qs.set('q', q)
  if (version) qs.set('version', version)
  const url = skillsContentUrl(id, '/dirs', `?${qs.toString()}`)
  const result = await skillsContentFetch(url, c.req.raw.signal)
  if (!result.ok) return c.json({ error: result.error }, 502)
  const { response } = result
  if (response.status === 404) return c.json({ error: 'Directory not found' }, 404)
  if (!response.ok) return c.json({ error: `Upstream returned ${response.status}` }, 502)
  const data = (await response.json()) as { entries: any[] }
  c.header('Cache-Control', 'no-cache')
  return c.json(data, 200)
})

const dirsZipRoute = createRoute({
  method: 'get',
  path: '/{id}/dirs/zip',
  tags: ['skills'],
  summary: 'Download a directory inside a skill package as a zip archive',
  security: [{ bearerAuth: [] }],
  request: { params: IdParam, query: PathQuery },
  responses: {
    200: { description: 'Zip archive', content: { 'application/zip': { schema: BinarySchema } } },
    404: {
      description: 'Skill or directory not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    502: {
      description: 'Upstream unavailable',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

skills.openapi(dirsZipRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const { path } = c.req.valid('query')
  const ok = await ensureSkillVisible(user.sub, id)
  if (ok === 404) return c.json({ error: 'Skill not found' }, 404)
  return proxyScsBinary(
    c,
    skillsContentUrl(id, '/dirs/zip', `?path=${encodeURIComponent(path)}`),
    'application/zip',
  )
})

// ── GET /:id/versions ─────────────────────────────────────────────────────
const listVersionsRoute = createRoute({
  method: 'get',
  path: '/{id}/versions',
  tags: ['skills'],
  summary: 'List published versions for a skill (newest first)',
  security: [{ bearerAuth: [] }],
  request: { params: IdParam },
  responses: {
    200: {
      description: 'Version list',
      content: { 'application/json': { schema: z.array(ApiSkillVersionSchema) } },
    },
    404: {
      description: 'Skill not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

skills.openapi(listVersionsRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const versions = await skillsService.listVersions(user.sub, id)
  return c.json(versions.map(versionToApi), 200)
})

// ── GET /:id/versions/:vid/package ────────────────────────────────────────
const versionPackageRoute = createRoute({
  method: 'get',
  path: '/{id}/versions/{vid}/package',
  tags: ['skills'],
  summary: 'Download one historical version package',
  security: [{ bearerAuth: [] }],
  request: { params: SkillVersionIdParam },
  responses: {
    200: {
      description: 'Version package',
      content: { 'application/gzip': { schema: BinarySchema } },
    },
    404: {
      description: 'Skill or version not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

skills.openapi(versionPackageRoute, async (c) => {
  const user = c.get('user')
  const { id, vid } = c.req.valid('param')
  const ok = await ensureSkillVisible(user.sub, id)
  if (ok === 404) return c.json({ error: 'Skill not found' }, 404)
  return proxyScsBinary(c, skillsContentUrl(id, `/versions/${encodeURIComponent(vid)}/package`))
})

// ── POST /:id/publish ─────────────────────────────────────────────────────
const publishRoute = createRoute({
  method: 'post',
  path: '/{id}/publish',
  tags: ['skills'],
  summary: 'Publish the native draft as a new active version',
  security: [{ bearerAuth: [] }],
  request: {
    params: IdParam,
    body: { required: false, content: { 'application/json': { schema: SkillPublishBodySchema } } },
  },
  responses: {
    200: {
      description: 'Published',
      content: {
        'application/json': {
          schema: z.object({ skill: ApiSkillSchema, version: ApiSkillVersionSchema }),
        },
      },
    },
    400: {
      description: 'No draft or invalid',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Skill not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    502: {
      description: 'skills-content-service unavailable',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

skills.openapi(publishRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const body: z.infer<typeof SkillPublishBodySchema> = await c.req.json().catch(() => ({}))
  const { skill, version } = await skillsService.publishDraft(user.sub, id, body.note)
  return c.json({ skill: ownerSkillMetaToApi(skill), version: versionToApi(version) }, 200)
})

// ── PUT /:id/active-version ───────────────────────────────────────────────
const setActiveRoute = createRoute({
  method: 'put',
  path: '/{id}/active-version',
  tags: ['skills'],
  summary: 'Switch the active version pointer (owner only)',
  security: [{ bearerAuth: [] }],
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: SkillActiveVersionBodySchema } } },
  },
  responses: {
    200: {
      description: 'Updated skill',
      content: { 'application/json': { schema: ApiSkillSchema } },
    },
    404: {
      description: 'Skill or version not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    502: {
      description: 'skills-content-service unavailable',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

skills.openapi(setActiveRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const body = c.req.valid('json')
  const { skill } = await skillsService.setActiveVersion(user.sub, id, body.version_id)
  return c.json(ownerSkillMetaToApi(skill), 200)
})

// ── GET /:id/grants ───────────────────────────────────────────────────────
const listGrantsRoute = createRoute({
  method: 'get',
  path: '/{id}/grants',
  tags: ['skills'],
  summary: 'List team grants for a skill (owner only)',
  security: [{ bearerAuth: [] }],
  request: { params: IdParam },
  responses: {
    200: {
      description: 'Grant list',
      content: { 'application/json': { schema: z.array(ApiSkillGrantSchema) } },
    },
    404: {
      description: 'Skill not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

skills.openapi(listGrantsRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const rows = await skillsService.listGrants(user.sub, id)
  return c.json(rows, 200)
})

// ── PUT /:id/grants ───────────────────────────────────────────────────────
const setGrantsRoute = createRoute({
  method: 'put',
  path: '/{id}/grants',
  tags: ['skills'],
  summary: 'Replace team grants for a skill (owner only)',
  security: [{ bearerAuth: [] }],
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: SkillGrantsBodySchema } } },
  },
  responses: {
    200: {
      description: 'Grant list',
      content: { 'application/json': { schema: z.array(ApiSkillGrantSchema) } },
    },
    400: {
      description: 'Invalid grants',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Skill not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

skills.openapi(setGrantsRoute, async (c) => {
  const user = c.get('user')
  const { id } = c.req.valid('param')
  const { grants } = c.req.valid('json')
  const rows = await skillsService.setGrants(user.sub, id, grants)
  return c.json(rows, 200)
})

export default skills
