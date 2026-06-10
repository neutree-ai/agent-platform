/**
 * skills-content-service entry.
 *
 * Post-p3, scs is the sole writer of `skills`, `skill_sources`, and
 * `skill_versions`. cp orchestrates ACLs, snapshots dependents, and forwards
 * mutations through this HTTP surface. Reads of the skill content tree still
 * go through a local dufs sidecar against the unpack cache.
 *
 * Endpoint surface mirrors `control-plane/src/services/skills-content.ts`
 * 1:1; the JSON shapes are defined there too.
 */
import { serve } from '@hono/node-server'
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { Scalar } from '@scalar/hono-api-reference'
import { logger } from 'hono/logger'
import { ensureUnpacked } from './cache'
import {
  clearDraftPackage,
  deleteSkill,
  deleteSource,
  findSkillByOwnerName,
  getActiveVersionHash,
  getActiveVersionPackage,
  getDraftPackage,
  getSkillById,
  getSourceById,
  getVersionPackage,
  insertSkill,
  insertSkillSource,
  insertVersion,
  patchSkill,
  patchSource,
  pool,
  saveDraftPackage,
  setActiveVersion,
  withTx,
} from './db'
import {
  DraftPathError,
  clearDraftScratch,
  deleteDraftFile,
  listDraftTree,
  readDraftFile,
  writeDraftFile,
} from './draft-cache'
import { DUFS_ORIGIN, startDufs } from './dufs'
import {
  importFromGit,
  scanGit,
  scanTarballBytes,
  switchSourceToGit,
  syncSource,
} from './from-git'
import { startLruSweep } from './lru'

const MAX_SKILL_PACKAGE_BYTES = Number(process.env.MAX_SKILL_PACKAGE_BYTES || 50 * 1024 * 1024)

const app = new OpenAPIHono()

app.use('*', async (c, next) => {
  if (c.req.path === '/health') return next()
  return logger()(c, next)
})

app.get('/health', (c) => c.json({ status: 'ok' }))

// ── shared schemas ─────────────────────────────────────────────────────────

const ErrorSchema = z.object({ error: z.string() })
const BinarySchema = z.unknown().openapi({ type: 'string', format: 'binary' })
const IdParam = z.object({ id: z.string() })
const SkillIdParam = z.object({ id: z.string() })
const VersionParam = z.object({ id: z.string(), vid: z.string() })
// `version` lets the caller view a non-active version. Omitted = active.
const PathQuery = z.object({
  path: z.string().default('/'),
  version: z.string().optional(),
})
const SearchQuery = z.object({
  path: z.string().default('/'),
  q: z.string().optional(),
  version: z.string().optional(),
})
const VisibilityEnum = z.enum(['private', 'team', 'public'])

const ScanCandidateFile = z.object({ path: z.string(), size: z.number() })
const ScanCandidate = z.object({
  subpath: z.string(),
  name: z.string().nullable(),
  description: z.string().nullable(),
  fileCount: z.number(),
  files: z.array(ScanCandidateFile),
  skillMd: z.string().nullable(),
})

const SkillSchema = z.object({
  id: z.string(),
  source_id: z.string(),
  source_kind: z.enum(['git', 'native']),
  active_version_id: z.string().nullable(),
  name: z.string(),
  subpath: z.string(),
  description: z.string(),
  user_id: z.string(),
  is_public: z.boolean(),
  visibility: VisibilityEnum,
  owner_name: z.string(),
  category: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})

const SourceSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  kind: z.enum(['git', 'native']),
  git_type: z.string().nullable(),
  git_url: z.string().nullable(),
  git_host: z.string().nullable(),
  git_owner: z.string().nullable(),
  git_repo: z.string().nullable(),
  git_ref: z.string().nullable(),
  credential_name: z.string().nullable(),
  last_commit_sha: z.string().nullable(),
  last_synced_at: z.string().nullable(),
  has_draft: z.boolean(),
  skill_count: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
})

const VersionSchema = z.object({
  id: z.string(),
  skill_id: z.string(),
  source_id: z.string(),
  content_hash: z.string(),
  commit_sha: z.string().nullable(),
  note: z.string().nullable(),
  published_at: z.string(),
  published_by: z.string(),
})

// ── bounded body reader ────────────────────────────────────────────────────

async function readBoundedBody(
  req: Request,
  maxBytes: number = MAX_SKILL_PACKAGE_BYTES,
): Promise<Buffer | { error: 'too-large' | 'empty' }> {
  const reader = req.body?.getReader()
  if (!reader) return { error: 'empty' }
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      reader.cancel().catch(() => {})
      return { error: 'too-large' }
    }
    chunks.push(value)
  }
  if (total === 0) return { error: 'empty' }
  return Buffer.concat(chunks)
}

// ── scan ───────────────────────────────────────────────────────────────────

const ScanGitBody = z.object({
  url: z.string().min(1),
  type: z.string().optional(),
  ref: z.string().optional(),
  token: z.string().optional(),
})

const scanGitRoute = createRoute({
  method: 'post',
  path: '/scan-git',
  tags: ['scan'],
  summary: 'Scan a git repo for skill candidates without persisting',
  request: { body: { content: { 'application/json': { schema: ScanGitBody } } } },
  responses: {
    200: {
      description: 'Scan result',
      content: {
        'application/json': {
          schema: z.object({
            candidates: z.array(ScanCandidate),
            requested_subpath: z.string().nullable(),
            commit_sha: z.string().nullable(),
          }),
        },
      },
    },
    400: { description: 'Bad URL', content: { 'application/json': { schema: ErrorSchema } } },
    502: {
      description: 'Upstream failed',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

app.openapi(scanGitRoute, async (c) => {
  const body = c.req.valid('json')
  const r = await scanGit(body)
  if (!r.ok) {
    if (r.status === 400) return c.json({ error: r.error }, 400)
    return c.json({ error: r.error }, 502)
  }
  return c.json(r.data, 200)
})

const scanTarballRoute = createRoute({
  method: 'post',
  path: '/scan-tarball',
  tags: ['scan'],
  summary: 'Scan an uploaded tarball for skill candidates',
  request: { body: { content: { 'application/gzip': { schema: BinarySchema } } } },
  responses: {
    200: {
      description: 'Scan result',
      content: {
        'application/json': { schema: z.object({ candidates: z.array(ScanCandidate) }) },
      },
    },
    400: { description: 'Bad body', content: { 'application/json': { schema: ErrorSchema } } },
    413: { description: 'Too large', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

app.openapi(scanTarballRoute, async (c) => {
  const declared = Number(c.req.header('content-length') || 0)
  if (declared > MAX_SKILL_PACKAGE_BYTES) {
    return c.json({ error: `Body exceeds limit (${declared} bytes)` }, 413)
  }
  const body = await readBoundedBody(c.req.raw)
  if ('error' in body) {
    if (body.error === 'empty') return c.json({ error: 'Empty body' }, 400)
    return c.json({ error: 'Body exceeds size limit' }, 413)
  }
  const r = await scanTarballBytes(body)
  if (!r.ok) return c.json({ error: r.error }, 400)
  return c.json(r.data, 200)
})

// ── sources/native ─────────────────────────────────────────────────────────

const CreateNativeSourceBody = z.object({
  user_id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(''),
  visibility: VisibilityEnum,
  category: z.string().nullable().optional(),
})

const createNativeSourceRoute = createRoute({
  method: 'post',
  path: '/sources/native',
  tags: ['sources'],
  summary: 'Create a native source + bare skill (no version yet)',
  request: { body: { content: { 'application/json': { schema: CreateNativeSourceBody } } } },
  responses: {
    201: {
      description: 'Created',
      content: {
        'application/json': {
          schema: z.object({ source: SourceSchema, skill: SkillSchema }),
        },
      },
    },
    400: { description: 'Bad input', content: { 'application/json': { schema: ErrorSchema } } },
    409: {
      description: 'Name already taken by this user',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

app.openapi(createNativeSourceRoute, async (c) => {
  const body = c.req.valid('json')
  try {
    const result = await withTx(async (client) => {
      const source = await insertSkillSource(client, {
        userId: body.user_id,
        kind: 'native',
      })
      const skill = await insertSkill(client, {
        userId: body.user_id,
        sourceId: source.id,
        name: body.name,
        subpath: '',
        description: body.description,
        visibility: body.visibility,
        category: body.category ?? null,
      })
      return { source, skill }
    })
    return c.json(result, 201)
  } catch (e) {
    const msg = (e as Error).message || ''
    if (msg.includes('skills_user_name_uniq')) {
      return c.json({ error: `Skill name "${body.name}" already exists for this user` }, 409)
    }
    throw e
  }
})

// ── sources/git/import ─────────────────────────────────────────────────────

const ImportGitBody = z.object({
  user_id: z.string().min(1),
  url: z.string().min(1),
  type: z.string().optional(),
  ref: z.string().optional(),
  token: z.string().optional(),
  credential_name: z.string().nullable().optional(),
  subpath: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  visibility: VisibilityEnum,
  category: z.string().nullable().optional(),
})

const importGitRoute = createRoute({
  method: 'post',
  path: '/sources/git/import',
  tags: ['sources'],
  summary: 'Ensure source + create skill + first version (idempotent on source)',
  request: { body: { content: { 'application/json': { schema: ImportGitBody } } } },
  responses: {
    201: {
      description: 'Imported',
      content: {
        'application/json': {
          schema: z.object({ source: SourceSchema, skill: SkillSchema, version: VersionSchema }),
        },
      },
    },
    400: { description: 'Bad input', content: { 'application/json': { schema: ErrorSchema } } },
    409: { description: 'Conflict', content: { 'application/json': { schema: ErrorSchema } } },
    413: { description: 'Too large', content: { 'application/json': { schema: ErrorSchema } } },
    502: {
      description: 'Upstream failed',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

app.openapi(importGitRoute, async (c) => {
  const body = c.req.valid('json')
  try {
    const r = await importFromGit({
      userId: body.user_id,
      url: body.url,
      type: body.type,
      ref: body.ref,
      token: body.token,
      credentialName: body.credential_name ?? null,
      subpath: body.subpath,
      nameOverride: body.name,
      descriptionOverride: body.description,
      visibility: body.visibility,
      category: body.category ?? null,
    })
    if (!r.ok) {
      if (r.status === 400) return c.json({ error: r.error }, 400)
      if (r.status === 413) return c.json({ error: r.error }, 413)
      if (r.status === 502) return c.json({ error: r.error }, 502)
      return c.json({ error: r.error }, 500 as never)
    }
    return c.json(r.data, 201)
  } catch (e) {
    const msg = (e as Error).message || ''
    if (msg.includes('skills_user_name_uniq')) {
      return c.json({ error: 'A skill with this name already exists for this user' }, 409)
    }
    throw e
  }
})

// ── skills/:id/switch-to-git ────────────────────────────────────────────────

const SwitchToGitBody = z.object({
  user_id: z.string().min(1),
  url: z.string().min(1),
  type: z.string().optional(),
  ref: z.string().optional(),
  token: z.string().optional(),
  credential_name: z.string().nullable().optional(),
  subpath: z.string(),
})

const switchToGitRoute = createRoute({
  method: 'post',
  path: '/skills/{id}/switch-to-git',
  tags: ['skills'],
  summary: 'Switch a native skill to a git source in place (wipes native history)',
  request: {
    params: SkillIdParam,
    body: { content: { 'application/json': { schema: SwitchToGitBody } } },
  },
  responses: {
    200: {
      description: 'Switched',
      content: {
        'application/json': {
          schema: z.object({ source: SourceSchema, skill: SkillSchema, version: VersionSchema }),
        },
      },
    },
    400: { description: 'Bad input', content: { 'application/json': { schema: ErrorSchema } } },
    404: { description: 'Skill not found', content: { 'application/json': { schema: ErrorSchema } } },
    409: { description: 'Conflict', content: { 'application/json': { schema: ErrorSchema } } },
    413: { description: 'Too large', content: { 'application/json': { schema: ErrorSchema } } },
    502: {
      description: 'Upstream failed',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

app.openapi(switchToGitRoute, async (c) => {
  const { id } = c.req.valid('param')
  const body = c.req.valid('json')
  const r = await switchSourceToGit({
    userId: body.user_id,
    skillId: id,
    url: body.url,
    type: body.type,
    ref: body.ref,
    token: body.token,
    credentialName: body.credential_name ?? null,
    subpath: body.subpath,
  })
  if (!r.ok) {
    if (r.status === 400) return c.json({ error: r.error }, 400)
    if (r.status === 404) return c.json({ error: r.error }, 404)
    if (r.status === 409) return c.json({ error: r.error }, 409)
    if (r.status === 413) return c.json({ error: r.error }, 413)
    if (r.status === 502) return c.json({ error: r.error }, 502)
    return c.json({ error: r.error }, 500 as never)
  }
  return c.json(r.data, 200)
})

// ── sources/:id/sync ───────────────────────────────────────────────────────

const SyncBody = z.object({
  token: z.string().optional(),
  published_by: z.string().min(1),
})

const SyncResultRow = z.object({
  skill_id: z.string(),
  version_id: z.string(),
  content_hash: z.string(),
  changed: z.boolean(),
})

const syncRoute = createRoute({
  method: 'post',
  path: '/sources/{id}/sync',
  tags: ['sources'],
  summary: 'Re-fetch a git source and refresh dependent skills',
  request: { params: IdParam, body: { content: { 'application/json': { schema: SyncBody } } } },
  responses: {
    200: {
      description: 'Sync result',
      content: {
        'application/json': {
          schema: z.object({
            source: SourceSchema,
            results: z.array(SyncResultRow),
            commit_sha: z.string().nullable(),
          }),
        },
      },
    },
    400: { description: 'Bad source', content: { 'application/json': { schema: ErrorSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    409: {
      description: 'Wrong source kind',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    502: {
      description: 'Upstream failed',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

app.openapi(syncRoute, async (c) => {
  const { id } = c.req.valid('param')
  const body = c.req.valid('json')
  const r = await syncSource({ sourceId: id, token: body.token, publishedBy: body.published_by })
  if (!r.ok) {
    if (r.status === 400) return c.json({ error: r.error }, 400)
    if (r.status === 404) return c.json({ error: r.error }, 404)
    if (r.status === 409) return c.json({ error: r.error }, 409)
    return c.json({ error: r.error }, 502)
  }
  return c.json(r.data, 200)
})

// ── PATCH /sources/:id ─────────────────────────────────────────────────────

const PatchSourceBody = z.object({
  credential_name: z.string().nullable().optional(),
  git_ref: z.string().optional(),
})

const patchSourceRoute = createRoute({
  method: 'patch',
  path: '/sources/{id}',
  tags: ['sources'],
  summary: 'Update source metadata (credential / ref)',
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: PatchSourceBody } } },
  },
  responses: {
    200: {
      description: 'Updated',
      content: { 'application/json': { schema: z.object({ source: SourceSchema }) } },
    },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

app.openapi(patchSourceRoute, async (c) => {
  const { id } = c.req.valid('param')
  const body = c.req.valid('json')
  const source = await patchSource(id, {
    credentialName: body.credential_name,
    gitRef: body.git_ref,
  })
  if (!source) return c.json({ error: 'Source not found' }, 404)
  return c.json({ source }, 200)
})

// ── DELETE /sources/:id ────────────────────────────────────────────────────

const deleteSourceRoute = createRoute({
  method: 'delete',
  path: '/sources/{id}',
  tags: ['sources'],
  summary: 'Delete a source (must have no dependent skills)',
  request: { params: IdParam },
  responses: {
    204: { description: 'Deleted' },
    409: {
      description: 'Has dependent skills',
      content: {
        'application/json': {
          schema: z.object({ error: z.string(), dependent_skills: z.array(z.string()) }),
        },
      },
    },
  },
})

app.openapi(deleteSourceRoute, async (c) => {
  const { id } = c.req.valid('param')
  const r = await deleteSource(id)
  if (!r.ok) {
    return c.json(
      { error: 'Source has dependent skills', dependent_skills: r.dependentSkills },
      409,
    )
  }
  return c.body(null, 204)
})

// ── draft (native sources) ─────────────────────────────────────────────────

const putDraftRoute = createRoute({
  method: 'put',
  path: '/sources/{id}/draft',
  tags: ['sources'],
  summary: 'Overwrite a native source draft package',
  request: {
    params: IdParam,
    body: { content: { 'application/gzip': { schema: BinarySchema } } },
  },
  responses: {
    200: {
      description: 'Saved',
      content: {
        'application/json': {
          schema: z.object({ ok: z.literal(true), byte_count: z.number() }),
        },
      },
    },
    400: { description: 'Empty body', content: { 'application/json': { schema: ErrorSchema } } },
    404: {
      description: 'Source not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    409: {
      description: 'Source is not native',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    413: { description: 'Too large', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

app.openapi(putDraftRoute, async (c) => {
  const { id } = c.req.valid('param')
  const source = await getSourceById(id)
  if (!source) return c.json({ error: 'Source not found' }, 404)
  if (source.kind !== 'native')
    return c.json({ error: 'Drafts are only valid for native sources' }, 409)

  const declared = Number(c.req.header('content-length') || 0)
  if (declared > MAX_SKILL_PACKAGE_BYTES) {
    return c.json({ error: `Package exceeds limit (${declared} bytes)` }, 413)
  }
  const body = await readBoundedBody(c.req.raw)
  if ('error' in body) {
    if (body.error === 'empty') return c.json({ error: 'Empty body' }, 400)
    return c.json({ error: 'Package exceeds size limit' }, 413)
  }
  const saved = await saveDraftPackage(id, body)
  if (!saved) return c.json({ error: 'Source not found' }, 404)
  return c.json({ ok: true as const, byte_count: saved.byteCount }, 200)
})

const deleteDraftRoute = createRoute({
  method: 'delete',
  path: '/sources/{id}/draft',
  tags: ['sources'],
  summary: 'Clear a native source draft package',
  request: { params: IdParam },
  responses: {
    204: { description: 'Cleared' },
    404: {
      description: 'Source not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    409: {
      description: 'Source is not native',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

app.openapi(deleteDraftRoute, async (c) => {
  const { id } = c.req.valid('param')
  const source = await getSourceById(id)
  if (!source) return c.json({ error: 'Source not found' }, 404)
  if (source.kind !== 'native')
    return c.json({ error: 'Drafts are only valid for native sources' }, 409)
  await clearDraftPackage(id)
  await clearDraftScratch(id)
  return c.body(null, 204)
})

// ── draft per-file editing (native sources) ─────────────────────────────────
//
// Per-file CRUD against the source's draft scratch dir. Every write
// persists the repacked tar.gz to `skill_sources.draft_package` so DB is
// the authoritative copy (see draft-cache.ts header).

async function getNativeSourceOr404(c: any, id: string) {
  const source = await getSourceById(id)
  if (!source) return { resp: c.json({ error: 'Source not found' }, 404) }
  if (source.kind !== 'native')
    return { resp: c.json({ error: 'Drafts are only valid for native sources' }, 409) }
  return { source }
}

const DraftTreeRoute = createRoute({
  method: 'get',
  path: '/sources/{id}/draft/files',
  tags: ['sources'],
  summary: 'List the draft scratch tree',
  request: { params: IdParam },
  responses: {
    200: {
      description: 'Tree',
      content: {
        'application/json': {
          schema: z.object({
            entries: z.array(
              z.object({
                path: z.string(),
                type: z.enum(['file', 'dir']),
                size: z.number().optional(),
              }),
            ),
          }),
        },
      },
    },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    409: { description: 'Not native', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

app.openapi(DraftTreeRoute, async (c) => {
  const { id } = c.req.valid('param')
  const result = await getNativeSourceOr404(c, id)
  if ('resp' in result) return result.resp
  const entries = await listDraftTree(id)
  return c.json({ entries }, 200)
})

const DraftFileQuery = z.object({ path: z.string().min(1) })

const DraftReadRoute = createRoute({
  method: 'get',
  path: '/sources/{id}/draft/file',
  tags: ['sources'],
  summary: 'Read a single draft file',
  request: { params: IdParam, query: DraftFileQuery },
  responses: {
    200: { description: 'Bytes', content: { 'application/octet-stream': { schema: BinarySchema } } },
    400: { description: 'Bad path', content: { 'application/json': { schema: ErrorSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    409: { description: 'Not native', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

app.openapi(DraftReadRoute, async (c) => {
  const { id } = c.req.valid('param')
  const { path } = c.req.valid('query')
  const result = await getNativeSourceOr404(c, id)
  if ('resp' in result) return result.resp
  let bytes: Buffer | null
  try {
    bytes = await readDraftFile(id, path)
  } catch (e) {
    if (e instanceof DraftPathError) return c.json({ error: 'invalid path' }, 400)
    throw e
  }
  if (!bytes) return c.json({ error: 'file not found' }, 404)
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { 'Content-Type': 'application/octet-stream' },
  })
})

const DraftWriteRoute = createRoute({
  method: 'put',
  path: '/sources/{id}/draft/file',
  tags: ['sources'],
  summary: 'Write a single draft file (creates draft from active version baseline if absent)',
  request: {
    params: IdParam,
    query: DraftFileQuery,
    body: { content: { 'application/octet-stream': { schema: BinarySchema } } },
  },
  responses: {
    200: {
      description: 'Saved',
      content: {
        'application/json': {
          schema: z.object({ ok: z.literal(true), byte_count: z.number() }),
        },
      },
    },
    400: { description: 'Bad path', content: { 'application/json': { schema: ErrorSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    409: { description: 'Not native', content: { 'application/json': { schema: ErrorSchema } } },
    413: { description: 'Too large', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

const MAX_SKILL_FILE_BYTES = Number(process.env.MAX_SKILL_FILE_BYTES || 5 * 1024 * 1024)

app.openapi(DraftWriteRoute, async (c) => {
  const { id } = c.req.valid('param')
  const { path } = c.req.valid('query')
  const result = await getNativeSourceOr404(c, id)
  if ('resp' in result) return result.resp
  // Cheap up-front reject for clients that bothered to send Content-Length.
  const declared = Number(c.req.header('content-length') || 0)
  if (declared > MAX_SKILL_FILE_BYTES) {
    return c.json({ error: `File exceeds limit (${declared} bytes)` }, 413)
  }
  // Read with a hard byte cap so a chunked / Content-Length-omitting client
  // can't stream gigabytes into RAM before we notice.
  const body = await readBoundedBody(c.req.raw, MAX_SKILL_FILE_BYTES)
  if ('error' in body) {
    if (body.error === 'empty') return c.json({ error: 'Empty body' }, 400)
    return c.json({ error: `File exceeds limit (${MAX_SKILL_FILE_BYTES} bytes)` }, 413)
  }
  try {
    const { byteCount } = await writeDraftFile(id, path, body)
    return c.json({ ok: true as const, byte_count: byteCount }, 200)
  } catch (e) {
    if (e instanceof DraftPathError) return c.json({ error: 'invalid path' }, 400)
    throw e
  }
})

const DraftDeleteRoute = createRoute({
  method: 'delete',
  path: '/sources/{id}/draft/file',
  tags: ['sources'],
  summary: 'Delete a single draft file',
  request: { params: IdParam, query: DraftFileQuery },
  responses: {
    204: { description: 'Deleted' },
    400: { description: 'Bad path', content: { 'application/json': { schema: ErrorSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    409: { description: 'Not native', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

app.openapi(DraftDeleteRoute, async (c) => {
  const { id } = c.req.valid('param')
  const { path } = c.req.valid('query')
  const result = await getNativeSourceOr404(c, id)
  if ('resp' in result) return result.resp
  let removed: boolean
  try {
    removed = await deleteDraftFile(id, path)
  } catch (e) {
    if (e instanceof DraftPathError) return c.json({ error: 'invalid path' }, 400)
    throw e
  }
  if (!removed) return c.json({ error: 'file not found' }, 404)
  return c.body(null, 204)
})

// ── POST /skills/upload (one-shot: source + skill + first version) ─────────

const UploadQuery = z.object({
  user_id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(''),
  visibility: VisibilityEnum,
  category: z.string().optional(),
})

const uploadRoute = createRoute({
  method: 'post',
  path: '/skills/upload',
  tags: ['skills'],
  summary: 'Upload a packaged skill (creates native source + skill + version)',
  request: {
    query: UploadQuery,
    body: { content: { 'application/gzip': { schema: BinarySchema } } },
  },
  responses: {
    200: {
      description: 'Re-uploaded (existing skill, new version appended + activated)',
      content: {
        'application/json': {
          schema: z.object({ source: SourceSchema, skill: SkillSchema, version: VersionSchema }),
        },
      },
    },
    201: {
      description: 'Created (new source + skill + initial version)',
      content: {
        'application/json': {
          schema: z.object({ source: SourceSchema, skill: SkillSchema, version: VersionSchema }),
        },
      },
    },
    400: { description: 'Bad input', content: { 'application/json': { schema: ErrorSchema } } },
    409: { description: 'Conflict', content: { 'application/json': { schema: ErrorSchema } } },
    413: { description: 'Too large', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

app.openapi(uploadRoute, async (c) => {
  const q = c.req.valid('query')
  const declared = Number(c.req.header('content-length') || 0)
  if (declared > MAX_SKILL_PACKAGE_BYTES) {
    return c.json({ error: `Package exceeds limit (${declared} bytes)` }, 413)
  }
  const body = await readBoundedBody(c.req.raw)
  if ('error' in body) {
    if (body.error === 'empty') return c.json({ error: 'Empty body' }, 400)
    return c.json({ error: 'Package exceeds size limit' }, 413)
  }

  // p3: upload is upsert on (user_id, name). Re-uploading an existing skill
  // (web "Publish Skill", agent's `publish_skill` MCP tool, second iteration
  // in the workspace edit-publish loop) appends a new version on the existing
  // skill row + flips active, instead of failing with `skills_user_name_uniq`.
  // The original source row is preserved — only native sources can be
  // re-uploaded; git sources reject (their content comes from sync only).
  const existing = await findSkillByOwnerName(q.user_id, q.name)
  if (existing) {
    const existingSource = await getSourceById(existing.source_id)
    if (!existingSource || existingSource.kind !== 'native') {
      return c.json(
        { error: `Skill "${q.name}" is backed by a git source; use sync, not upload` },
        409,
      )
    }
    const result = await withTx(async (client) => {
      const { version } = await insertVersion(client, {
        skillId: existing.id,
        sourceId: existingSource.id,
        package: body,
        commitSha: null,
        note: 're-upload',
        publishedBy: q.user_id,
      })
      const activated = await setActiveVersion(client, existing.id, version.id)
      return { source: existingSource, skill: activated ?? existing, version }
    })
    return c.json(result, 200)
  }

  const result = await withTx(async (client) => {
    const source = await insertSkillSource(client, {
      userId: q.user_id,
      kind: 'native',
    })
    const skill = await insertSkill(client, {
      userId: q.user_id,
      sourceId: source.id,
      name: q.name,
      subpath: '',
      description: q.description,
      visibility: q.visibility,
      category: q.category ?? null,
    })
    const { version } = await insertVersion(client, {
      skillId: skill.id,
      sourceId: source.id,
      package: body,
      commitSha: null,
      note: 'initial upload',
      publishedBy: q.user_id,
    })
    const activated = await setActiveVersion(client, skill.id, version.id)
    return { source, skill: activated ?? skill, version }
  })
  return c.json(result, 201)
})

// ── POST /skills/:id/publish (native draft → version) ─────────────────────

const PublishBody = z.object({
  published_by: z.string().min(1),
  note: z.string().optional(),
})

const publishRoute = createRoute({
  method: 'post',
  path: '/skills/{id}/publish',
  tags: ['skills'],
  summary: 'Publish a native skill from its draft package',
  request: {
    params: SkillIdParam,
    body: { content: { 'application/json': { schema: PublishBody } } },
  },
  responses: {
    201: {
      description: 'Published',
      content: {
        'application/json': {
          schema: z.object({ skill: SkillSchema, version: VersionSchema }),
        },
      },
    },
    404: {
      description: 'Skill not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    409: {
      description: 'Source is not native or no draft',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

app.openapi(publishRoute, async (c) => {
  const { id } = c.req.valid('param')
  const body = c.req.valid('json')
  const skill = await getSkillById(id)
  if (!skill) return c.json({ error: 'Skill not found' }, 404)
  const source = await getSourceById(skill.source_id)
  if (!source) return c.json({ error: 'Source not found' }, 404)
  if (source.kind !== 'native') {
    return c.json({ error: 'Publish is only valid for native-source skills' }, 409)
  }
  const draft = await getDraftPackage(source.id)
  if (!draft || draft.byteLength === 0) {
    return c.json({ error: 'No draft package to publish' }, 409)
  }

  const result = await withTx(async (client) => {
    const { version } = await insertVersion(client, {
      skillId: skill.id,
      sourceId: source.id,
      package: draft,
      commitSha: null,
      note: body.note ?? null,
      publishedBy: body.published_by,
    })
    const updated = await setActiveVersion(client, skill.id, version.id)
    // Clear draft inside the same tx so a publish failure doesn't lose work.
    await client.query(
      'UPDATE skill_sources SET draft_package = NULL, updated_at = NOW() WHERE id = $1',
      [source.id],
    )
    return { skill: updated ?? skill, version }
  })
  // Drop the scratch dir post-publish so reopening Edit re-hydrates from
  // the newly active version, not from the now-stale working copy.
  await clearDraftScratch(source.id)
  return c.json(result, 201)
})

// ── PUT /skills/:id/active-version ─────────────────────────────────────────

const ActiveVersionBody = z.object({ version_id: z.string().min(1) })

const setActiveRoute = createRoute({
  method: 'put',
  path: '/skills/{id}/active-version',
  tags: ['skills'],
  summary: 'Set the active version of a skill (rollback / switch)',
  request: {
    params: SkillIdParam,
    body: { content: { 'application/json': { schema: ActiveVersionBody } } },
  },
  responses: {
    200: {
      description: 'Updated',
      content: { 'application/json': { schema: z.object({ skill: SkillSchema }) } },
    },
    400: {
      description: 'Version does not belong to skill',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

app.openapi(setActiveRoute, async (c) => {
  const { id } = c.req.valid('param')
  const { version_id } = c.req.valid('json')
  const version = await pool
    .query<{ skill_id: string }>('SELECT skill_id FROM skill_versions WHERE id = $1', [version_id])
    .then((r) => r.rows[0] ?? null)
  if (!version) return c.json({ error: 'Version not found' }, 404)
  if (version.skill_id !== id) {
    return c.json({ error: 'Version does not belong to this skill' }, 400)
  }
  const skill = await withTx((client) => setActiveVersion(client, id, version_id))
  if (!skill) return c.json({ error: 'Skill not found' }, 404)
  return c.json({ skill }, 200)
})

// ── PATCH /skills/:id ─────────────────────────────────────────────────────

const PatchSkillBody = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  visibility: VisibilityEnum.optional(),
  category: z.string().nullable().optional(),
})

const patchSkillRoute = createRoute({
  method: 'patch',
  path: '/skills/{id}',
  tags: ['skills'],
  summary: 'Update skill metadata',
  request: {
    params: SkillIdParam,
    body: { content: { 'application/json': { schema: PatchSkillBody } } },
  },
  responses: {
    200: {
      description: 'Updated',
      content: { 'application/json': { schema: z.object({ skill: SkillSchema }) } },
    },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    409: { description: 'Name taken', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

app.openapi(patchSkillRoute, async (c) => {
  const { id } = c.req.valid('param')
  const body = c.req.valid('json')
  try {
    const skill = await patchSkill(id, body)
    if (!skill) return c.json({ error: 'Skill not found' }, 404)
    return c.json({ skill }, 200)
  } catch (e) {
    const msg = (e as Error).message || ''
    if (msg.includes('skills_user_name_uniq')) {
      return c.json({ error: 'Name already taken by this user' }, 409)
    }
    throw e
  }
})

// ── DELETE /skills/:id ─────────────────────────────────────────────────────

const deleteSkillRoute = createRoute({
  method: 'delete',
  path: '/skills/{id}',
  tags: ['skills'],
  summary: 'Delete a skill (cp pre-checks workspace / template references)',
  request: { params: SkillIdParam },
  responses: {
    204: { description: 'Deleted' },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

app.openapi(deleteSkillRoute, async (c) => {
  const { id } = c.req.valid('param')
  const ok = await deleteSkill(id)
  if (!ok) return c.json({ error: 'Skill not found' }, 404)
  return c.body(null, 204)
})

// ── content read paths ────────────────────────────────────────────────────

async function resolveActiveVersion(skillId: string): Promise<{ versionPrefix: string } | null> {
  const hash = await getActiveVersionHash(skillId)
  if (!hash) return null
  const key = hash.content_hash
  const dir = await ensureUnpacked(skillId, key, async () => {
    const row = await getActiveVersionPackage(skillId)
    return row?.package ?? null
  })
  if (!dir) return null
  const versionPrefix = `/${encodeURIComponent(skillId)}/${key}`
  return { versionPrefix }
}

async function resolveSpecificVersion(
  skillId: string,
  versionId: string,
): Promise<{ versionPrefix: string } | null> {
  const v = await getVersionPackage(versionId)
  if (!v || v.skill_id !== skillId) return null
  const dir = await ensureUnpacked(skillId, v.content_hash, async () => v.package)
  if (!dir) return null
  return { versionPrefix: `/${encodeURIComponent(skillId)}/${v.content_hash}` }
}

function encodePath(p: string): string {
  return p
    .replace(/^\//, '')
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')
}

const PASSTHROUGH = [
  'Content-Type',
  'Content-Disposition',
  'Content-Length',
  'ETag',
  'Last-Modified',
]

async function dufsFetch(
  versionPrefix: string,
  path: string,
  search: string,
  signal: AbortSignal,
): Promise<Response> {
  const sub = encodePath(path)
  const url = `${DUFS_ORIGIN}${versionPrefix}/${sub}${search}`
  return fetch(url, { method: 'GET', headers: { 'Accept-Encoding': 'identity' }, signal })
}

const readFileRoute = createRoute({
  method: 'get',
  path: '/skills/{id}/files',
  tags: ['content'],
  summary: 'Read a file from a skill (active version)',
  request: { params: SkillIdParam, query: PathQuery },
  responses: {
    200: { description: 'File', content: { 'application/octet-stream': { schema: BinarySchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    502: { description: 'Upstream', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

app.openapi(readFileRoute, async (c) => {
  const { id } = c.req.valid('param')
  const { path, version } = c.req.valid('query')
  const hit = version
    ? await resolveSpecificVersion(id, version)
    : await resolveActiveVersion(id)
  if (!hit) return c.json({ error: 'skill or version not found' }, 404)
  let resp: Response
  try {
    resp = await dufsFetch(hit.versionPrefix, path, '', c.req.raw.signal)
  } catch (e) {
    console.error('[skills-content] dufs fetch failed:', (e as Error).message)
    return c.json({ error: 'upstream unavailable' }, 502)
  }
  if (resp.status === 404) return c.json({ error: 'file not found' }, 404)
  if (!resp.ok) return c.json({ error: `dufs returned ${resp.status}` }, 502)
  const out = new Headers()
  for (const h of PASSTHROUGH) {
    const v = resp.headers.get(h)
    if (v) out.set(h, v)
  }
  return new Response(resp.body, { status: resp.status, headers: out })
})

const listDirRoute = createRoute({
  method: 'get',
  path: '/skills/{id}/dirs',
  tags: ['content'],
  summary: 'List directory entries (active version)',
  request: { params: SkillIdParam, query: SearchQuery },
  responses: {
    200: {
      description: 'Entries',
      content: { 'application/json': { schema: z.object({ entries: z.array(z.any()) }) } },
    },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    502: { description: 'Upstream', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

app.openapi(listDirRoute, async (c) => {
  const { id } = c.req.valid('param')
  const { path, q, version } = c.req.valid('query')
  const hit = version
    ? await resolveSpecificVersion(id, version)
    : await resolveActiveVersion(id)
  if (!hit) return c.json({ error: 'skill or version not found' }, 404)
  const search = q ? `?q=${encodeURIComponent(q)}&json` : '?json'
  let resp: Response
  try {
    resp = await dufsFetch(hit.versionPrefix, path, search, c.req.raw.signal)
  } catch (e) {
    console.error('[skills-content] dufs fetch failed:', (e as Error).message)
    return c.json({ error: 'upstream unavailable' }, 502)
  }
  if (resp.status === 404) return c.json({ error: 'directory not found' }, 404)
  if (!resp.ok) return c.json({ error: `dufs returned ${resp.status}` }, 502)
  const raw = (await resp.json().catch(() => null)) as unknown
  const isListing =
    Array.isArray(raw) ||
    (raw !== null &&
      typeof raw === 'object' &&
      'paths' in raw &&
      Array.isArray((raw as { paths: unknown }).paths))
  if (!isListing) return c.json({ error: 'not a directory' }, 404)
  const list = Array.isArray(raw) ? raw : (raw as { paths: unknown[] }).paths
  // Filter out cache-internal sentinels: `.access` is the LRU mtime marker
  // written by cache.ts:touchAccess at the version root; it should never
  // surface to skill consumers.
  const filtered = list.filter((e) => {
    if (e && typeof e === 'object' && 'name' in e) {
      return (e as { name?: unknown }).name !== '.access'
    }
    return true
  })
  return c.json({ entries: filtered }, 200)
})

const zipDirRoute = createRoute({
  method: 'get',
  path: '/skills/{id}/dirs/zip',
  tags: ['content'],
  summary: 'Download a directory as zip (active version)',
  request: { params: SkillIdParam, query: PathQuery },
  responses: {
    200: { description: 'Zip', content: { 'application/zip': { schema: BinarySchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    502: { description: 'Upstream', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

app.openapi(zipDirRoute, async (c) => {
  const { id } = c.req.valid('param')
  const { path } = c.req.valid('query')
  const hit = await resolveActiveVersion(id)
  if (!hit) return c.json({ error: 'skill or active version not found' }, 404)
  let resp: Response
  try {
    resp = await dufsFetch(hit.versionPrefix, path, '?zip', c.req.raw.signal)
  } catch (e) {
    console.error('[skills-content] dufs fetch failed:', (e as Error).message)
    return c.json({ error: 'upstream unavailable' }, 502)
  }
  if (resp.status === 404) return c.json({ error: 'directory not found' }, 404)
  if (!resp.ok) return c.json({ error: `dufs returned ${resp.status}` }, 502)
  const out = new Headers()
  for (const h of PASSTHROUGH) {
    const v = resp.headers.get(h)
    if (v) out.set(h, v)
  }
  if (!out.has('Content-Type')) out.set('Content-Type', 'application/zip')
  return new Response(resp.body, { status: resp.status, headers: out })
})

// Build an `attachment` Content-Disposition whose filename carries the skill
// name so downloads are recognizable (the URL's last segment is the generic
// "package"). RFC 5987 `filename*` preserves non-ASCII skill names; the ASCII
// `filename` is a fallback for older clients.
function packageDisposition(skillName: string, suffix = ''): string {
  const base = `${skillName}${suffix}.tar.gz`
  const ascii = base.replace(/[^\x20-\x7E]/g, '_').replace(/["\\/]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(base)}`
}

// ── GET /skills/:id/package ───────────────────────────────────────────────
//
// Shortcut: stream the skill's currently-active version. The legacy
// download contract (`/_cp/skills/:name/package` → cp proxy → here) lives
// in this route; the agent-skills client at workspace boot is the dominant
// caller. Returns 404 when the skill has no active version (transient state
// right after create, or after every version was deleted).

const skillPackageRoute = createRoute({
  method: 'get',
  path: '/skills/{id}/package',
  tags: ['content'],
  summary: "Download the skill's active version as tar.gz",
  request: { params: SkillIdParam },
  responses: {
    200: { description: 'Package', content: { 'application/gzip': { schema: BinarySchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

app.openapi(skillPackageRoute, async (c) => {
  const { id } = c.req.valid('param')
  // Conditional download: probe the active version's content hash first (cheap,
  // no bytea read). The agent-skills client at workspace boot/reload sends the
  // ETag it last extracted; when it still matches we 304 and skip streaming the
  // package entirely. Fanout reloads (one skill edit reloads every workspace
  // that has it) make almost every package request a no-change probe.
  const hashRow = await getActiveVersionHash(id)
  if (!hashRow) return c.json({ error: 'Skill or active version not found' }, 404)
  const etag = `"${hashRow.content_hash}"`
  if (c.req.header('If-None-Match') === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } })
  }
  const row = await getActiveVersionPackage(id)
  if (!row) return c.json({ error: 'Skill or active version not found' }, 404)
  const view = new Uint8Array(row.package.byteLength)
  view.set(row.package)
  return new Response(view, {
    status: 200,
    headers: {
      'Content-Type': 'application/gzip',
      'Content-Length': String(row.package.byteLength),
      'Content-Disposition': packageDisposition(row.name),
      ETag: etag,
    },
  })
})

// ── GET /skills/:id/versions/:vid/package ─────────────────────────────────

const versionPackageRoute = createRoute({
  method: 'get',
  path: '/skills/{id}/versions/{vid}/package',
  tags: ['content'],
  summary: 'Download a specific version of a skill as tar.gz',
  request: { params: VersionParam },
  responses: {
    200: { description: 'Package', content: { 'application/gzip': { schema: BinarySchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

app.openapi(versionPackageRoute, async (c) => {
  const { id, vid } = c.req.valid('param')
  const row = await getVersionPackage(vid)
  if (!row || row.skill_id !== id) return c.json({ error: 'Version not found' }, 404)
  const view = new Uint8Array(row.package.byteLength)
  view.set(row.package)
  return new Response(view, {
    status: 200,
    headers: {
      'Content-Type': 'application/gzip',
      'Content-Length': String(row.package.byteLength),
      // Tag historical downloads with a short content hash so multiple
      // versions of the same skill don't collide in the downloads folder.
      'Content-Disposition': packageDisposition(row.name, `-${row.content_hash.slice(0, 8)}`),
    },
  })
})

// ── openapi + boot ─────────────────────────────────────────────────────────

app.doc31('/api/docs/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'NAP skills-content-service',
    version: '0.3.0',
    description:
      'Owner of skills / skill_sources / skill_versions writes (p3); read-side dufs proxy retained.',
  },
})

app.get(
  '/api/docs',
  Scalar({ url: '/api/docs/openapi.json', pageTitle: 'NAP skills-content-service' } as any),
)

startDufs()
startLruSweep()

const port = Number(process.env.PORT || 3008)
const server = serve({ fetch: app.fetch, port }, ({ port: bound }) => {
  console.log(`skills-content-service listening on :${bound}`)
})

async function shutdown(signal: string) {
  console.log(`received ${signal}, shutting down`)
  server.close()
  await pool.end().catch(() => {})
  process.exit(0)
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

// Resolving the specific-version helper is referenced by the version-package
// route's cache prefetch hook; suppress the "declared but never used" warning
// in the bundle path without dropping the helper for future endpoints.
void resolveSpecificVersion
