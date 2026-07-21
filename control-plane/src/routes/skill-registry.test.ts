/**
 * Public skill registry routing.
 *
 * The client walks a fixed path shape and treats any non-200 as "no skills
 * here", so a route that fails to match is indistinguishable from an empty
 * registry. These tests pin the URLs the client actually requests.
 *
 * Slug rules themselves live in `internal/types/skill-slug.test.ts` — the slug here is
 * whatever was frozen onto the export row at mint time.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getActiveSkillExportToken = vi.hoisted(() => vi.fn())
const skillsContentFetch = vi.hoisted(() => vi.fn())

vi.mock('../services/db/skill-export-tokens', () => ({
  getActiveSkillExportToken,
  touchSkillExportToken: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../services/skills-content', () => ({
  skillsContentFetch,
  skillsContentUrl: (id: string, sub: string) => `http://scs/skills/${id}${sub}`,
}))

const { skillRegistryApp } = await import('./skill-registry')

const SKILL_ID = '3f2a1b9c-4d5e-6f70-8192-a3b4c5d6e7f8'

const EXPORT_RECORD = {
  token: 'skexp_testtoken',
  skill_id: SKILL_ID,
  user_id: 'u1',
  slug: 'code-review',
  label: '',
  expires_at: null,
  last_used_at: null,
  created_at: new Date('2026-07-20T00:00:00Z'),
  skill_name: 'Code Review',
  skill_description: 'Review code for bugs',
  content_hash: 'a'.repeat(64),
}

const INDEX_PATH = 'http://host/skexp_testtoken/.well-known/agent-skills/index.json'

describe('skill registry routes', () => {
  beforeEach(() => {
    getActiveSkillExportToken.mockReset()
    skillsContentFetch.mockReset()
  })

  it('serves a v0.2.0 index at the path the client probes', async () => {
    getActiveSkillExportToken.mockResolvedValue(EXPORT_RECORD)
    const res = await skillRegistryApp.request(INDEX_PATH)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.$schema).toBe('https://schemas.agentskills.io/discovery/0.2.0/schema.json')
    expect(body.skills).toEqual([
      {
        name: 'code-review',
        type: 'archive',
        description: 'Review code for bugs',
        url: 'code-review.tar.gz',
        digest: `sha256:${'a'.repeat(64)}`,
      },
    ])
  })

  it('publishes the frozen slug, not one re-derived from the current name', async () => {
    // The skill was renamed after the export was minted. The install on
    // someone's disk is keyed to the old slug, so that is what we keep serving.
    getActiveSkillExportToken.mockResolvedValue({ ...EXPORT_RECORD, skill_name: 'Renamed Thing' })
    const res = await skillRegistryApp.request(INDEX_PATH)
    const body = await res.json()
    expect(body.skills[0].name).toBe('code-review')
    expect(body.skills[0].url).toBe('code-review.tar.gz')
  })

  it('resolves the relative archive url the index advertises', async () => {
    getActiveSkillExportToken.mockResolvedValue(EXPORT_RECORD)
    // The client resolves `code-review.tar.gz` against the index URL.
    const archiveUrl = new URL('code-review.tar.gz', INDEX_PATH).toString()
    skillsContentFetch.mockResolvedValue({
      ok: true,
      response: new Response('tarball', { status: 200, headers: { ETag: '"abc"' } }),
    })
    const res = await skillRegistryApp.request(archiveUrl)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/gzip')
    expect(res.headers.get('ETag')).toBe('"abc"')
  })

  it('forwards If-None-Match and passes a 304 straight through', async () => {
    getActiveSkillExportToken.mockResolvedValue(EXPORT_RECORD)
    skillsContentFetch.mockResolvedValue({
      ok: true,
      response: new Response(null, { status: 304, headers: { ETag: '"abc"' } }),
    })
    const res = await skillRegistryApp.request(
      'http://host/skexp_testtoken/.well-known/agent-skills/code-review.tar.gz',
      { headers: { 'If-None-Match': '"abc"' } },
    )
    expect(res.status).toBe(304)
    expect(skillsContentFetch.mock.calls[0][2]).toEqual({ 'If-None-Match': '"abc"' })
  })

  it('404s an unknown or expired token', async () => {
    getActiveSkillExportToken.mockResolvedValue(null)
    const res = await skillRegistryApp.request(INDEX_PATH)
    expect(res.status).toBe(404)
  })

  it('404s an exported skill that has no published version', async () => {
    getActiveSkillExportToken.mockResolvedValue({ ...EXPORT_RECORD, content_hash: null })
    const res = await skillRegistryApp.request(INDEX_PATH)
    expect(res.status).toBe(404)
  })

  it('substitutes a non-empty description when the skill has none', async () => {
    // An empty description makes the client drop the entry.
    getActiveSkillExportToken.mockResolvedValue({ ...EXPORT_RECORD, skill_description: '   ' })
    const res = await skillRegistryApp.request(INDEX_PATH)
    const body = await res.json()
    expect(body.skills[0].description).toBe('code-review')
  })

  it('clamps an over-long description to the client limit', async () => {
    getActiveSkillExportToken.mockResolvedValue({
      ...EXPORT_RECORD,
      skill_description: 'x'.repeat(2000),
    })
    const res = await skillRegistryApp.request(INDEX_PATH)
    const body = await res.json()
    expect(body.skills[0].description.length).toBeLessThanOrEqual(1024)
  })

  it('answers the bare export URL with the install command', async () => {
    getActiveSkillExportToken.mockResolvedValue(EXPORT_RECORD)
    const res = await skillRegistryApp.request('http://host/skexp_testtoken')
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('npx skills add http://host/skexp_testtoken')
  })
})
