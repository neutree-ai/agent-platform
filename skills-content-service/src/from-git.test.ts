/**
 * Orchestration tests for scanGit / scanTarball / importFromGit / syncSource.
 *
 * Pre-p3 these orchestrators worked against `skills.package`. Post-p3 they
 * write to `skill_sources` + `skill_versions` instead, so the mock surface
 * is wider: every db helper from-git.ts touches is stubbed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildTarGz } from './tar-fixtures'

const mocks = vi.hoisted(() => {
  const fetchTarball = vi.fn<(url: string, headers: Record<string, string>) => Promise<Buffer>>()
  const fetchCommitSha = vi.fn<(source: unknown, token?: string) => Promise<string | null>>()
  const findGitSource = vi.fn()
  const findSkillByOwnerName = vi.fn()
  const findSkillBySourceSubpath = vi.fn()
  const getActiveVersionHash = vi.fn()
  const getSourceById = vi.fn()
  const insertSkill = vi.fn()
  const insertSkillSource = vi.fn()
  const insertVersion = vi.fn()
  const listSkillsBySource = vi.fn()
  const markSourceSynced = vi.fn()
  const setActiveVersion = vi.fn()
  const withTx = vi.fn(async (fn: (client: unknown) => unknown) => fn({}))
  return {
    fetchTarball,
    fetchCommitSha,
    findGitSource,
    findSkillByOwnerName,
    findSkillBySourceSubpath,
    getActiveVersionHash,
    getSourceById,
    insertSkill,
    insertSkillSource,
    insertVersion,
    listSkillsBySource,
    markSourceSynced,
    setActiveVersion,
    withTx,
  }
})

vi.mock('./git-source-client', () => ({
  UndiciGitSourceClient: class {
    fetchTarball = mocks.fetchTarball
    fetchCommitSha = mocks.fetchCommitSha
  },
}))

vi.mock('./db', () => ({
  pool: {},
  findGitSource: mocks.findGitSource,
  findSkillByOwnerName: mocks.findSkillByOwnerName,
  findSkillBySourceSubpath: mocks.findSkillBySourceSubpath,
  getActiveVersionHash: mocks.getActiveVersionHash,
  getSourceById: mocks.getSourceById,
  insertSkill: mocks.insertSkill,
  insertSkillSource: mocks.insertSkillSource,
  insertVersion: mocks.insertVersion,
  listSkillsBySource: mocks.listSkillsBySource,
  markSourceSynced: mocks.markSourceSynced,
  setActiveVersion: mocks.setActiveVersion,
  withTx: mocks.withTx,
}))

import { importFromGit, scanGit, scanTarballBytes, syncSource } from './from-git'

const SKILL_MD = (name: string, desc?: string) =>
  desc ? `---\nname: ${name}\ndescription: ${desc}\n---\nbody` : `---\nname: ${name}\n---\nbody`

beforeEach(() => {
  for (const k of Object.values(mocks)) {
    if (typeof (k as { mockReset?: () => void }).mockReset === 'function') {
      ;(k as { mockReset: () => void }).mockReset()
    }
  }
  mocks.withTx.mockImplementation(async (fn) => fn({}))
})

// Tarball with a single root-level skill, wrapped under the github-style
// owner-repo-sha/ prefix the strip pipeline expects.
function singleSkillTarball(prefix = 'owner-repo-deadbeef/'): Promise<Buffer> {
  return buildTarGz([
    { name: `${prefix}SKILL.md`, content: SKILL_MD('myskill', 'a description') },
    { name: `${prefix}assets/file.txt`, content: 'hello' },
  ])
}

describe('scanGit', () => {
  it('returns candidates from a single-skill repo', async () => {
    mocks.fetchTarball.mockResolvedValueOnce(await singleSkillTarball())
    mocks.fetchCommitSha.mockResolvedValueOnce('deadbeef')
    const r = await scanGit({ url: 'https://github.com/owner/repo' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.candidates).toHaveLength(1)
    expect(r.data.candidates[0].subpath).toBe('')
    expect(r.data.candidates[0].name).toBe('myskill')
    expect(r.data.commit_sha).toBe('deadbeef')
  })

  it('returns 400 on a bad URL', async () => {
    const r = await scanGit({ url: 'not a url' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(400)
  })

  it('returns 502 when the tarball fetch fails', async () => {
    mocks.fetchTarball.mockRejectedValueOnce(new Error('boom'))
    const r = await scanGit({ url: 'https://github.com/owner/repo' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(502)
  })
})

describe('scanTarballBytes', () => {
  it('rejects empty bodies', async () => {
    const r = await scanTarballBytes(Buffer.alloc(0))
    expect(r.ok).toBe(false)
  })

  it('returns candidates for a user-packed tarball (no owner-repo prefix)', async () => {
    const bytes = await buildTarGz([
      { name: 'SKILL.md', content: SKILL_MD('packed') },
      { name: 'tool/script.py', content: 'print()' },
    ])
    const r = await scanTarballBytes(bytes)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.candidates).toHaveLength(1)
    expect(r.data.candidates[0].name).toBe('packed')
  })
})

describe('importFromGit', () => {
  it('creates a new source + skill + version when no source matches', async () => {
    mocks.fetchTarball.mockResolvedValueOnce(await singleSkillTarball())
    mocks.fetchCommitSha.mockResolvedValueOnce('deadbeef')
    mocks.findGitSource.mockResolvedValueOnce(null)
    mocks.insertSkillSource.mockResolvedValueOnce({ id: 'src1', kind: 'git' })
    mocks.findSkillBySourceSubpath.mockResolvedValueOnce(null)
    mocks.insertSkill.mockResolvedValueOnce({ id: 'sk1', source_id: 'src1', name: 'myskill' })
    mocks.insertVersion.mockResolvedValueOnce({
      version: { id: 'v1', skill_id: 'sk1', source_id: 'src1', content_hash: 'h' },
      created: true,
    })
    mocks.setActiveVersion.mockResolvedValueOnce({ id: 'sk1', active_version_id: 'v1' })

    const r = await importFromGit({
      userId: 'u1',
      url: 'https://github.com/owner/repo',
      subpath: '',
      visibility: 'private',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.source.id).toBe('src1')
    expect(r.data.skill.id).toBe('sk1')
    expect(r.data.version.id).toBe('v1')
    expect(mocks.insertSkillSource).toHaveBeenCalledOnce()
  })

  it('reuses an existing source on (user, url, ref) hit', async () => {
    mocks.fetchTarball.mockResolvedValueOnce(await singleSkillTarball())
    mocks.fetchCommitSha.mockResolvedValueOnce(null)
    mocks.findGitSource.mockResolvedValueOnce({ id: 'src1', kind: 'git' })
    mocks.findSkillBySourceSubpath.mockResolvedValueOnce(null)
    mocks.insertSkill.mockResolvedValueOnce({ id: 'sk1', source_id: 'src1', name: 'myskill' })
    mocks.insertVersion.mockResolvedValueOnce({
      version: { id: 'v1', skill_id: 'sk1', source_id: 'src1', content_hash: 'h' },
      created: true,
    })
    mocks.setActiveVersion.mockResolvedValueOnce({ id: 'sk1', active_version_id: 'v1' })

    const r = await importFromGit({
      userId: 'u1',
      url: 'https://github.com/owner/repo',
      subpath: '',
      visibility: 'private',
    })
    expect(r.ok).toBe(true)
    expect(mocks.insertSkillSource).not.toHaveBeenCalled()
  })

  it('returns 400 when SKILL.md is missing at the subpath', async () => {
    // No SKILL.md at root or nested.
    mocks.fetchTarball.mockResolvedValueOnce(
      await buildTarGz([{ name: 'owner-repo-sha/README.md', content: 'hi' }]),
    )
    const r = await importFromGit({
      userId: 'u1',
      url: 'https://github.com/owner/repo',
      subpath: '',
      visibility: 'private',
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(400)
  })
})

describe('syncSource', () => {
  it('returns 404 when the source row is missing', async () => {
    mocks.getSourceById.mockResolvedValueOnce(null)
    const r = await syncSource({ sourceId: 'nope', publishedBy: 'u1' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(404)
  })

  it('returns 409 when called on a native source', async () => {
    mocks.getSourceById.mockResolvedValueOnce({ id: 'src1', kind: 'native' })
    const r = await syncSource({ sourceId: 'src1', publishedBy: 'u1' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(409)
  })

  it('marks rows changed when content_hash differs from active version', async () => {
    mocks.getSourceById.mockResolvedValueOnce({
      id: 'src1',
      kind: 'git',
      git_url: 'https://github.com/owner/repo',
      git_type: 'github',
      git_ref: null,
    })
    mocks.fetchTarball.mockResolvedValueOnce(await singleSkillTarball())
    mocks.fetchCommitSha.mockResolvedValueOnce('deadbeef')
    mocks.listSkillsBySource.mockResolvedValueOnce([
      { id: 'sk1', source_id: 'src1', subpath: '', name: 'myskill' },
    ])
    mocks.getActiveVersionHash.mockResolvedValueOnce({ content_hash: 'OLDHASH' })
    mocks.insertVersion.mockResolvedValueOnce({
      version: { id: 'v2', skill_id: 'sk1', source_id: 'src1', content_hash: 'NEWHASH' },
      created: true,
    })
    mocks.setActiveVersion.mockResolvedValueOnce({})
    mocks.markSourceSynced.mockResolvedValueOnce({ id: 'src1', kind: 'git' })

    const r = await syncSource({ sourceId: 'src1', publishedBy: 'u1' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.results).toHaveLength(1)
    expect(r.data.results[0].changed).toBe(true)
    expect(r.data.results[0].content_hash).toBe('NEWHASH')
  })

  it('marks rows unchanged when content_hash matches', async () => {
    mocks.getSourceById.mockResolvedValueOnce({
      id: 'src1',
      kind: 'git',
      git_url: 'https://github.com/owner/repo',
      git_type: 'github',
      git_ref: null,
    })
    mocks.fetchTarball.mockResolvedValueOnce(await singleSkillTarball())
    mocks.fetchCommitSha.mockResolvedValueOnce('deadbeef')
    mocks.listSkillsBySource.mockResolvedValueOnce([
      { id: 'sk1', source_id: 'src1', subpath: '', name: 'myskill' },
    ])
    mocks.getActiveVersionHash.mockResolvedValueOnce({ content_hash: 'SAMEHASH' })
    mocks.insertVersion.mockResolvedValueOnce({
      version: { id: 'v1', skill_id: 'sk1', source_id: 'src1', content_hash: 'SAMEHASH' },
      created: false,
    })
    mocks.markSourceSynced.mockResolvedValueOnce({ id: 'src1', kind: 'git' })

    const r = await syncSource({ sourceId: 'src1', publishedBy: 'u1' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.results[0].changed).toBe(false)
    expect(mocks.setActiveVersion).not.toHaveBeenCalled()
  })
})
