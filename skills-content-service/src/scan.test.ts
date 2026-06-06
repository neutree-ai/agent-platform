import { describe, expect, it } from 'vitest'
import { scanSkills } from './scan'
import { extractEntries } from './skill-tar'
import { buildTarGz } from './tar-fixtures'

const SKILL_MD = (name: string, desc?: string) =>
  desc ? `---\nname: ${name}\ndescription: ${desc}\n---\nbody` : `---\nname: ${name}\n---\nbody`

describe('scanSkills', () => {
  it('finds a root-only skill', async () => {
    const bytes = await buildTarGz([
      { name: 'SKILL.md', content: SKILL_MD('root', 'root one') },
      { name: 'helper.py', content: '' },
    ])
    const entries = await extractEntries(bytes)
    const out = scanSkills(entries)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      subpath: '',
      name: 'root',
      description: 'root one',
      fileCount: 2,
    })
    expect(out[0].files.map((f) => f.path).sort()).toEqual(['SKILL.md', 'helper.py'])
    expect(out[0].skillMd).toContain('name: root')
  })

  it('finds multiple nested skills sorted alphabetically', async () => {
    const bytes = await buildTarGz([
      { name: 'foo/SKILL.md', content: SKILL_MD('foo') },
      { name: 'foo/helper.ts', content: '' },
      { name: 'bar/SKILL.md', content: SKILL_MD('bar', 'bar skill') },
      { name: 'bar/lib/util.ts', content: '' },
    ])
    const entries = await extractEntries(bytes)
    const out = scanSkills(entries)
    expect(out.map((s) => s.subpath)).toEqual(['bar', 'foo'])
    // Files are returned relative to each skill's root (subpath prefix stripped).
    expect(out[0]).toMatchObject({
      subpath: 'bar',
      name: 'bar',
      description: 'bar skill',
      fileCount: 2,
    })
    expect(out[0].files.map((f) => f.path).sort()).toEqual(['SKILL.md', 'lib/util.ts'])
    expect(out[1]).toMatchObject({ subpath: 'foo', name: 'foo', description: null, fileCount: 2 })
    expect(out[1].files.map((f) => f.path).sort()).toEqual(['SKILL.md', 'helper.ts'])
  })

  it('puts root skill first, nested skills after', async () => {
    const bytes = await buildTarGz([
      { name: 'SKILL.md', content: SKILL_MD('root') },
      { name: 'nested/SKILL.md', content: SKILL_MD('n') },
    ])
    const entries = await extractEntries(bytes)
    const out = scanSkills(entries)
    expect(out.map((s) => s.subpath)).toEqual(['', 'nested'])
  })

  it('root file count excludes files inside nested skill dirs', async () => {
    const bytes = await buildTarGz([
      { name: 'SKILL.md', content: SKILL_MD('root') },
      { name: 'helper.ts', content: '' },
      { name: 'nested/SKILL.md', content: SKILL_MD('n') },
      { name: 'nested/x.ts', content: '' },
    ])
    const entries = await extractEntries(bytes)
    const out = scanSkills(entries)
    const root = out.find((s) => s.subpath === '')!
    const nested = out.find((s) => s.subpath === 'nested')!
    expect(root.fileCount).toBe(2) // SKILL.md + helper.ts; nested/* excluded
    expect(nested.fileCount).toBe(2) // SKILL.md + x.ts
  })

  it('handles missing frontmatter gracefully', async () => {
    const bytes = await buildTarGz([{ name: 'SKILL.md', content: '# no frontmatter here' }])
    const entries = await extractEntries(bytes)
    const out = scanSkills(entries)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      subpath: '',
      name: null,
      description: null,
      fileCount: 1,
    })
    expect(out[0].skillMd).toBe('# no frontmatter here')
  })

  it('returns empty when no SKILL.md anywhere', async () => {
    const bytes = await buildTarGz([{ name: 'readme.md', content: 'hi' }])
    const entries = await extractEntries(bytes)
    expect(scanSkills(entries)).toEqual([])
  })
})
