/**
 * Route-level tests for /api/skills (p3 id-keyed surface).
 *
 * Strategy: mock `skills-composition` (the singleton `skillsService` +
 * `skillRepo`) and `skills-content` so we exercise just the HTTP handler
 * mapping — query parsing, status code translation, request body shape —
 * without spinning up a real DB or real scs.
 *
 * Coverage philosophy: happy path + one error per endpoint. The deeper
 * branch matrix is owned by `skills-service.test.ts`.
 */
import { OpenAPIHono } from '@hono/zod-openapi'
import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest'

// ── hoisted shared spies ────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  // skillsService (singleton)
  list: vi.fn(),
  getSkill: vi.fn(),
  patchMeta: vi.fn(),
  remove: vi.fn(),
  listGrants: vi.fn(),
  setGrants: vi.fn(),
  listSources: vi.fn(),
  getSource: vi.fn(),
  listSkillsForSource: vi.fn(),
  listVersions: vi.fn(),
  scanGit: vi.fn(),
  scanTarball: vi.fn(),
  createNativeSource: vi.fn(),
  importFromGit: vi.fn(),
  uploadSkill: vi.fn(),
  saveDraft: vi.fn(),
  discardDraft: vi.fn(),
  publishDraft: vi.fn(),
  syncSource: vi.fn(),
  setActiveVersion: vi.fn(),
  removeSource: vi.fn(),
  // skills-content
  scsPatchSource: vi.fn(),
  skillsContentFetch: vi.fn(),
  skillsContentUrl: vi.fn().mockReturnValue('http://scs.local/x'),
  // credentials
  getUserCredentialValue: vi.fn(),
}))

vi.mock('../../services/skills-composition', () => ({
  skillRepo: {},
  skillsService: {
    list: mocks.list,
    getSkill: mocks.getSkill,
    patchMeta: mocks.patchMeta,
    remove: mocks.remove,
    listGrants: mocks.listGrants,
    setGrants: mocks.setGrants,
    listSources: mocks.listSources,
    getSource: mocks.getSource,
    listSkillsForSource: mocks.listSkillsForSource,
    listVersions: mocks.listVersions,
    scanGit: mocks.scanGit,
    scanTarball: mocks.scanTarball,
    createNativeSource: mocks.createNativeSource,
    importFromGit: mocks.importFromGit,
    uploadSkill: mocks.uploadSkill,
    saveDraft: mocks.saveDraft,
    discardDraft: mocks.discardDraft,
    publishDraft: mocks.publishDraft,
    syncSource: mocks.syncSource,
    setActiveVersion: mocks.setActiveVersion,
    removeSource: mocks.removeSource,
  },
}))

vi.mock('../../services/skills-content', () => ({
  scsPatchSource: mocks.scsPatchSource,
  skillsContentFetch: mocks.skillsContentFetch,
  skillsContentUrl: mocks.skillsContentUrl,
}))

vi.mock('../../services/db/credentials', () => ({
  getUserCredentialValue: mocks.getUserCredentialValue,
}))

const { default: skillsRoutes } = await import('../skills')

// ── harness ─────────────────────────────────────────────────────────────────
const FAKE_USER = {
  sub: 'alice',
  username: 'alice',
  name: 'Alice',
  role: 'user' as const,
  exp: Math.floor(Date.now() / 1000) + 3600,
}

function makeApp(): OpenAPIHono {
  const app = new OpenAPIHono()
  app.use('*', async (c, next) => {
    ;(c as unknown as { set: (k: string, v: unknown) => void }).set('user', FAKE_USER)
    await next()
  })
  app.route('/api/skills', skillsRoutes as unknown as OpenAPIHono)
  return app
}

function makeSkill(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'sk-1',
    source_id: 'src-1',
    active_version_id: 'v-1',
    name: 'demo',
    subpath: '',
    description: '',
    user_id: 'alice',
    is_public: false,
    visibility: 'private',
    my_permission: 'owner',
    shared_via_teams: [],
    owner_name: 'Alice',
    is_owner: true,
    category: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...over,
  }
}

function makeSource(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'src-1',
    user_id: 'alice',
    kind: 'native',
    git_type: null,
    git_url: null,
    git_host: null,
    git_owner: null,
    git_repo: null,
    git_ref: null,
    credential_name: null,
    last_commit_sha: null,
    last_synced_at: null,
    has_draft: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...over,
  }
}

function makeVersion(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'v-1',
    skill_id: 'sk-1',
    source_id: 'src-1',
    content_hash: 'h',
    commit_sha: null,
    note: null,
    published_at: new Date().toISOString(),
    published_by: 'alice',
    ...over,
  }
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) (fn as Mock).mockReset()
  mocks.skillsContentUrl.mockReturnValue('http://scs.local/x')
})

// ── GET /api/skills ─────────────────────────────────────────────────────────

describe('GET /api/skills', () => {
  it('forwards filters to skillsService.list', async () => {
    mocks.list.mockResolvedValue([])
    const app = makeApp()
    const res = await app.request('/api/skills?q=alpha&owner=carol&visibility=public')
    expect(res.status).toBe(200)
    expect(mocks.list).toHaveBeenCalledWith('alice', {
      query: 'alpha',
      ownerId: 'carol',
      categories: undefined,
      visibility: 'public',
    })
  })

  it('parses comma-separated category list', async () => {
    mocks.list.mockResolvedValue([])
    const app = makeApp()
    await app.request('/api/skills?category=coding,writing,uncategorized')
    expect(mocks.list).toHaveBeenCalledWith('alice', {
      query: undefined,
      ownerId: undefined,
      categories: ['coding', 'writing', 'uncategorized'],
      visibility: undefined,
    })
  })

  it('returns the serialized list', async () => {
    mocks.list.mockResolvedValue([makeSkill()])
    const app = makeApp()
    const res = await app.request('/api/skills')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Array<{ id: string; is_own: boolean }>
    expect(body[0].id).toBe('sk-1')
    expect(body[0].is_own).toBe(true)
  })

  it('rejects unknown visibility value with 400', async () => {
    const app = makeApp()
    const res = await app.request('/api/skills?visibility=secret')
    expect(res.status).toBe(400)
  })
})

// ── GET /api/skills/:id ─────────────────────────────────────────────────────

describe('GET /api/skills/:id', () => {
  it('returns the skill', async () => {
    mocks.getSkill.mockResolvedValue(makeSkill())
    const app = makeApp()
    const res = await app.request('/api/skills/sk-1')
    expect(res.status).toBe(200)
    expect(mocks.getSkill).toHaveBeenCalledWith('alice', 'sk-1')
  })

  it('404s when the service throws SkillNotFoundError', async () => {
    const { SkillNotFoundError } = await import('../../services/skills-errors')
    mocks.getSkill.mockRejectedValue(new SkillNotFoundError())
    const app = makeApp()
    const res = await app.request('/api/skills/missing')
    expect(res.status).toBe(404)
  })
})

// ── PATCH /api/skills/:id ───────────────────────────────────────────────────

describe('PATCH /api/skills/:id', () => {
  it('happy path', async () => {
    mocks.patchMeta.mockResolvedValue(makeSkill({ description: 'new' }))
    const app = makeApp()
    const res = await app.request('/api/skills/sk-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'new' }),
    })
    expect(res.status).toBe(200)
    expect(mocks.patchMeta).toHaveBeenCalledWith({
      userId: 'alice',
      skillId: 'sk-1',
      name: undefined,
      description: 'new',
      visibility: undefined,
      grants: undefined,
      category: undefined,
    })
  })

  it('403 on NotAllowedError', async () => {
    const { NotAllowedError } = await import('../../services/skills-errors')
    mocks.patchMeta.mockRejectedValue(new NotAllowedError())
    const app = makeApp()
    const res = await app.request('/api/skills/sk-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ visibility: 'public' }),
    })
    expect(res.status).toBe(403)
  })

  it('409 on ConflictError', async () => {
    const { ConflictError } = await import('../../services/skills-errors')
    mocks.patchMeta.mockRejectedValue(new ConflictError('still in use'))
    const app = makeApp()
    const res = await app.request('/api/skills/sk-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ visibility: 'private' }),
    })
    expect(res.status).toBe(409)
  })
})

// ── DELETE /api/skills/:id ──────────────────────────────────────────────────

describe('DELETE /api/skills/:id', () => {
  it('204 on success', async () => {
    mocks.remove.mockResolvedValue(undefined)
    const app = makeApp()
    const res = await app.request('/api/skills/sk-1', { method: 'DELETE' })
    expect(res.status).toBe(204)
    expect(mocks.remove).toHaveBeenCalledWith('alice', 'sk-1')
  })

  it('409 on ConflictError (still attached)', async () => {
    const { ConflictError } = await import('../../services/skills-errors')
    mocks.remove.mockRejectedValue(new ConflictError('still attached'))
    const app = makeApp()
    const res = await app.request('/api/skills/sk-1', { method: 'DELETE' })
    expect(res.status).toBe(409)
  })
})

// ── POST /api/skills (upload) ───────────────────────────────────────────────

describe('POST /api/skills (upload)', () => {
  it('413s when Content-Length declares oversize', async () => {
    const app = makeApp()
    const res = await app.request('/api/skills?name=big&visibility=private', {
      method: 'POST',
      headers: { 'content-length': String(60 * 1024 * 1024) },
      body: 'x',
    })
    expect(res.status).toBe(413)
    expect(mocks.uploadSkill).not.toHaveBeenCalled()
  })

  it('happy path: 201 with serialized skill', async () => {
    mocks.uploadSkill.mockResolvedValue({
      source: makeSource(),
      skill: makeSkill({ name: 'new' }),
      version: makeVersion(),
    })
    const app = makeApp()
    const res = await app.request('/api/skills?name=new&visibility=private', {
      method: 'POST',
      headers: { 'content-length': '10' },
      body: 'tarball',
    })
    expect(res.status).toBe(201)
    expect(mocks.uploadSkill).toHaveBeenCalledTimes(1)
    const call = mocks.uploadSkill.mock.calls[0][0]
    expect(call.name).toBe('new')
    expect(call.userId).toBe('alice')
  })

  it('502 when service throws (scs down)', async () => {
    mocks.uploadSkill.mockRejectedValue(new Error('scs 502: down'))
    const app = makeApp()
    const res = await app.request('/api/skills?name=x&visibility=private', {
      method: 'POST',
      headers: { 'content-length': '10' },
      body: 'tarball',
    })
    expect(res.status).toBe(502)
  })
})

// ── POST /api/skills/from-git ───────────────────────────────────────────────

describe('POST /api/skills/from-git', () => {
  it('resolves credential to a token before calling the service', async () => {
    mocks.getUserCredentialValue.mockResolvedValue('secret-token')
    mocks.importFromGit.mockResolvedValue({
      source: makeSource(),
      skill: makeSkill({ name: 'imported' }),
      version: makeVersion(),
    })
    const app = makeApp()
    const res = await app.request('/api/skills/from-git', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'https://github.com/o/r',
        subpath: 'skills/a',
        visibility: 'private',
        credential_name: 'mycred',
      }),
    })
    expect(res.status).toBe(201)
    expect(mocks.getUserCredentialValue).toHaveBeenCalledWith('alice', 'mycred')
    expect(mocks.importFromGit).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'secret-token', credentialName: 'mycred' }),
    )
  })

  it('404s when the named credential is missing', async () => {
    mocks.getUserCredentialValue.mockResolvedValue(null)
    const app = makeApp()
    const res = await app.request('/api/skills/from-git', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'https://github.com/o/r',
        subpath: 'skills/a',
        visibility: 'private',
        credential_name: 'nope',
      }),
    })
    expect(res.status).toBe(404)
    expect(mocks.importFromGit).not.toHaveBeenCalled()
  })
})

// ── POST /api/skills/scan-git ───────────────────────────────────────────────

describe('POST /api/skills/scan-git', () => {
  it('forwards token + url to the service', async () => {
    mocks.getUserCredentialValue.mockResolvedValue('tok')
    mocks.scanGit.mockResolvedValue({
      candidates: [],
      requested_subpath: null,
      commit_sha: 'abc',
    })
    const app = makeApp()
    const res = await app.request('/api/skills/scan-git', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'https://github.com/o/r',
        ref: 'main',
        credential_name: 'mycred',
      }),
    })
    expect(res.status).toBe(200)
    expect(mocks.scanGit).toHaveBeenCalledWith(
      'alice',
      expect.objectContaining({ url: 'https://github.com/o/r', ref: 'main', token: 'tok' }),
    )
  })

  it('400 when service throws InvalidInputError', async () => {
    const { InvalidInputError } = await import('../../services/skills-errors')
    mocks.scanGit.mockRejectedValue(new InvalidInputError('bad url'))
    const app = makeApp()
    const res = await app.request('/api/skills/scan-git', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'not-a-url' }),
    })
    expect(res.status).toBe(400)
  })
})

// ── POST /api/skills/sources/native ─────────────────────────────────────────

describe('POST /api/skills/sources/native', () => {
  it('happy path returns 201 with source + skill', async () => {
    mocks.createNativeSource.mockResolvedValue({
      source: makeSource(),
      skill: makeSkill(),
    })
    const app = makeApp()
    const res = await app.request('/api/skills/sources/native', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'n', description: 'd', visibility: 'private' }),
    })
    expect(res.status).toBe(201)
    expect(mocks.createNativeSource).toHaveBeenCalledWith({
      userId: 'alice',
      name: 'n',
      description: 'd',
      visibility: 'private',
      category: null,
    })
  })
})

// ── GET /api/skills/sources ─────────────────────────────────────────────────

describe('GET /api/skills/sources', () => {
  it('lists sources for the user, optionally filtered by kind', async () => {
    mocks.listSources.mockResolvedValue([makeSource({ kind: 'git' })])
    const app = makeApp()
    const res = await app.request('/api/skills/sources?kind=git')
    expect(res.status).toBe(200)
    expect(mocks.listSources).toHaveBeenCalledWith('alice', 'git')
  })
})

// ── GET /api/skills/sources/:id ─────────────────────────────────────────────

describe('GET /api/skills/sources/:id', () => {
  it('returns source on success', async () => {
    mocks.getSource.mockResolvedValue(makeSource())
    const app = makeApp()
    const res = await app.request('/api/skills/sources/src-1')
    expect(res.status).toBe(200)
    expect(mocks.getSource).toHaveBeenCalledWith('alice', 'src-1')
  })

  it('404s when service throws SkillNotFoundError', async () => {
    const { SkillNotFoundError } = await import('../../services/skills-errors')
    mocks.getSource.mockRejectedValue(new SkillNotFoundError('Source not found'))
    const app = makeApp()
    const res = await app.request('/api/skills/sources/ghost')
    expect(res.status).toBe(404)
  })
})

// ── GET /api/skills/sources/:id/skills ──────────────────────────────────────

describe('GET /api/skills/sources/:id/skills', () => {
  it('lists derived skills', async () => {
    mocks.listSkillsForSource.mockResolvedValue([makeSkill()])
    const app = makeApp()
    const res = await app.request('/api/skills/sources/src-1/skills')
    expect(res.status).toBe(200)
    expect(mocks.listSkillsForSource).toHaveBeenCalledWith('alice', 'src-1')
  })
})

// ── DELETE /api/skills/sources/:id ──────────────────────────────────────────

describe('DELETE /api/skills/sources/:id', () => {
  it('204 on success', async () => {
    mocks.removeSource.mockResolvedValue(undefined)
    const app = makeApp()
    const res = await app.request('/api/skills/sources/src-1', { method: 'DELETE' })
    expect(res.status).toBe(204)
  })

  it('409 when source still has skills', async () => {
    const { ConflictError } = await import('../../services/skills-errors')
    mocks.removeSource.mockRejectedValue(new ConflictError('still has skills'))
    const app = makeApp()
    const res = await app.request('/api/skills/sources/src-1', { method: 'DELETE' })
    expect(res.status).toBe(409)
  })
})

// ── POST /api/skills/sources/:id/sync ───────────────────────────────────────

describe('POST /api/skills/sources/:id/sync', () => {
  it('happy path forwards body shape with resolved credential', async () => {
    mocks.getSource.mockResolvedValue(makeSource({ kind: 'git', credential_name: 'stored' }))
    mocks.getUserCredentialValue.mockResolvedValue('resolved-token')
    mocks.syncSource.mockResolvedValue({
      source: makeSource(),
      results: [],
      commit_sha: 'sha',
    })
    const app = makeApp()
    const res = await app.request('/api/skills/sources/src-1/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(200)
    expect(mocks.getUserCredentialValue).toHaveBeenCalledWith('alice', 'stored')
    expect(mocks.syncSource).toHaveBeenCalledWith('alice', 'src-1', 'resolved-token')
  })

  it('400 when service rejects native source', async () => {
    const { InvalidInputError } = await import('../../services/skills-errors')
    mocks.getSource.mockResolvedValue(makeSource({ kind: 'native' }))
    mocks.syncSource.mockRejectedValue(new InvalidInputError('Only git sources can sync'))
    const app = makeApp()
    const res = await app.request('/api/skills/sources/src-1/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(400)
  })
})

// ── PUT /api/skills/sources/:id/draft ───────────────────────────────────────

describe('PUT /api/skills/sources/:id/draft', () => {
  it('413s when Content-Length over the cap', async () => {
    const app = makeApp()
    const res = await app.request('/api/skills/sources/src-1/draft', {
      method: 'PUT',
      headers: { 'content-length': String(60 * 1024 * 1024) },
      body: 'x',
    })
    expect(res.status).toBe(413)
    expect(mocks.saveDraft).not.toHaveBeenCalled()
  })

  it('happy path returns 200 with byte_count', async () => {
    mocks.saveDraft.mockResolvedValue({ ok: true, byte_count: 7 })
    const app = makeApp()
    const res = await app.request('/api/skills/sources/src-1/draft', {
      method: 'PUT',
      headers: { 'content-length': '7' },
      body: 'tarball',
    })
    expect(res.status).toBe(200)
    expect(mocks.saveDraft).toHaveBeenCalled()
  })
})

// ── DELETE /api/skills/sources/:id/draft ────────────────────────────────────

describe('DELETE /api/skills/sources/:id/draft', () => {
  it('204 on success', async () => {
    mocks.discardDraft.mockResolvedValue(undefined)
    const app = makeApp()
    const res = await app.request('/api/skills/sources/src-1/draft', { method: 'DELETE' })
    expect(res.status).toBe(204)
  })
})

// ── GET /api/skills/:id/versions ────────────────────────────────────────────

describe('GET /api/skills/:id/versions', () => {
  it('returns the version list', async () => {
    mocks.listVersions.mockResolvedValue([makeVersion()])
    const app = makeApp()
    const res = await app.request('/api/skills/sk-1/versions')
    expect(res.status).toBe(200)
    expect(mocks.listVersions).toHaveBeenCalledWith('alice', 'sk-1')
  })

  it('404 when skill invisible', async () => {
    const { SkillNotFoundError } = await import('../../services/skills-errors')
    mocks.listVersions.mockRejectedValue(new SkillNotFoundError())
    const app = makeApp()
    const res = await app.request('/api/skills/sk-1/versions')
    expect(res.status).toBe(404)
  })
})

// ── POST /api/skills/:id/publish ────────────────────────────────────────────

describe('POST /api/skills/:id/publish', () => {
  it('happy path returns 200 with skill + version', async () => {
    mocks.publishDraft.mockResolvedValue({ skill: makeSkill(), version: makeVersion() })
    const app = makeApp()
    const res = await app.request('/api/skills/sk-1/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ note: 'release' }),
    })
    expect(res.status).toBe(200)
    expect(mocks.publishDraft).toHaveBeenCalledWith('alice', 'sk-1', 'release')
  })

  it('404 when not owner / not found', async () => {
    const { SkillNotFoundError } = await import('../../services/skills-errors')
    mocks.publishDraft.mockRejectedValue(new SkillNotFoundError())
    const app = makeApp()
    const res = await app.request('/api/skills/sk-1/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(404)
  })
})

// ── PUT /api/skills/:id/active-version ──────────────────────────────────────

describe('PUT /api/skills/:id/active-version', () => {
  it('happy path', async () => {
    mocks.setActiveVersion.mockResolvedValue({ skill: makeSkill() })
    const app = makeApp()
    const res = await app.request('/api/skills/sk-1/active-version', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version_id: 'v-2' }),
    })
    expect(res.status).toBe(200)
    expect(mocks.setActiveVersion).toHaveBeenCalledWith('alice', 'sk-1', 'v-2')
  })

  it('404 when service throws', async () => {
    const { SkillNotFoundError } = await import('../../services/skills-errors')
    mocks.setActiveVersion.mockRejectedValue(new SkillNotFoundError())
    const app = makeApp()
    const res = await app.request('/api/skills/sk-1/active-version', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version_id: 'v-2' }),
    })
    expect(res.status).toBe(404)
  })
})

// ── GET /api/skills/:id/grants ──────────────────────────────────────────────

describe('GET /api/skills/:id/grants', () => {
  it('returns the grant list for the owner', async () => {
    mocks.listGrants.mockResolvedValue([
      { team_id: 't1', team_name: 'T1', permission: 'editor', granted_at: 'now' },
    ])
    const app = makeApp()
    const res = await app.request('/api/skills/sk-1/grants')
    expect(res.status).toBe(200)
    expect(mocks.listGrants).toHaveBeenCalledWith('alice', 'sk-1')
  })

  it('404 to a non-owner', async () => {
    const { SkillNotFoundError } = await import('../../services/skills-errors')
    mocks.listGrants.mockRejectedValue(new SkillNotFoundError())
    const app = makeApp()
    const res = await app.request('/api/skills/sk-1/grants')
    expect(res.status).toBe(404)
  })
})

// ── PUT /api/skills/:id/grants ──────────────────────────────────────────────

describe('PUT /api/skills/:id/grants', () => {
  it('happy path', async () => {
    mocks.setGrants.mockResolvedValue([
      { team_id: 't1', team_name: 'T1', permission: 'viewer', granted_at: 'now' },
    ])
    const app = makeApp()
    const res = await app.request('/api/skills/sk-1/grants', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grants: [{ team_id: 't1', permission: 'viewer' }] }),
    })
    expect(res.status).toBe(200)
    expect(mocks.setGrants).toHaveBeenCalledWith('alice', 'sk-1', [
      { team_id: 't1', permission: 'viewer' },
    ])
  })

  it('400 on InvalidInputError', async () => {
    const { InvalidInputError } = await import('../../services/skills-errors')
    mocks.setGrants.mockRejectedValue(new InvalidInputError('bad'))
    const app = makeApp()
    const res = await app.request('/api/skills/sk-1/grants', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grants: [] }),
    })
    expect(res.status).toBe(400)
  })
})

// ── PATCH /api/skills/sources/:id ───────────────────────────────────────────

describe('PATCH /api/skills/sources/:id', () => {
  it('happy path calls scsPatchSource after authorization', async () => {
    mocks.getSource.mockResolvedValue(makeSource())
    mocks.scsPatchSource.mockResolvedValue({ ok: true, value: { source: makeSource() } })
    const app = makeApp()
    const res = await app.request('/api/skills/sources/src-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ git_ref: 'develop' }),
    })
    expect(res.status).toBe(200)
    expect(mocks.scsPatchSource).toHaveBeenCalledWith('src-1', {
      credential_name: undefined,
      git_ref: 'develop',
    })
  })

  it('404 when source not visible to caller', async () => {
    const { SkillNotFoundError } = await import('../../services/skills-errors')
    mocks.getSource.mockRejectedValue(new SkillNotFoundError())
    const app = makeApp()
    const res = await app.request('/api/skills/sources/src-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(404)
    expect(mocks.scsPatchSource).not.toHaveBeenCalled()
  })
})
