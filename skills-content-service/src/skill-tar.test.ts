import { describe, expect, it } from 'vitest'
import {
  extractEntries,
  filterSubpath,
  findSkillMd,
  listNestedSkillDirs,
  normalizeUploadToTarGz,
  repack,
  stripPrefix,
} from './skill-tar'
import { buildTarGz } from './tar-fixtures'
import { buildZip } from './zip-fixtures'

describe('extractEntries', () => {
  it('round-trips a multi-entry tarball', async () => {
    const bytes = await buildTarGz([
      { name: 'a.txt', content: 'A' },
      { name: 'sub/b.txt', content: 'BB' },
    ])
    const entries = await extractEntries(bytes)
    expect(entries.map((e) => e.header.name)).toEqual(['a.txt', 'sub/b.txt'])
    expect(entries[0].data.toString()).toBe('A')
    expect(entries[1].data.toString()).toBe('BB')
  })

  it('rejects on malformed bytes', async () => {
    await expect(extractEntries(Buffer.from('not a tarball'))).rejects.toBeTruthy()
  })

  it('round-trips a multi-entry zip', async () => {
    const entries = await extractEntries(
      buildZip([
        { name: 'a.txt', content: 'A' },
        { name: 'sub/b.txt', content: 'BB' },
      ]),
    )
    expect(entries.map((e) => e.header.name).sort()).toEqual(['a.txt', 'sub/b.txt'])
    const byName = new Map(entries.map((e) => [e.header.name, e]))
    expect(byName.get('a.txt')?.data.toString()).toBe('A')
    expect(byName.get('sub/b.txt')?.data.toString()).toBe('BB')
    expect(byName.get('a.txt')?.header.type).toBe('file')
  })

  it('keeps zip directory entries as directories', async () => {
    const entries = await extractEntries(
      buildZip([
        { name: 'empty-dir', type: 'directory' },
        { name: 'SKILL.md', content: 'hi' },
      ]),
    )
    const dir = entries.find((e) => e.header.name === 'empty-dir/')
    expect(dir?.header.type).toBe('directory')
    expect(dir?.data.length).toBe(0)
  })

  it('drops macOS archiver noise from a zip', async () => {
    const entries = await extractEntries(
      buildZip([
        { name: 'SKILL.md', content: 'hi' },
        { name: '__MACOSX/._SKILL.md', content: 'resource fork' },
        { name: '.DS_Store', content: 'junk' },
        { name: 'sub/._x.txt', content: 'resource fork' },
      ]),
    )
    expect(entries.map((e) => e.header.name)).toEqual(['SKILL.md'])
  })

  it('rejects a truncated zip', async () => {
    const zip = buildZip([{ name: 'a.txt', content: 'A' }])
    await expect(extractEntries(zip.subarray(0, zip.length - 8))).rejects.toBeTruthy()
  })

  it('feeds the same pipeline from either format', async () => {
    const fromZip = await extractEntries(
      buildZip([
        { name: 'pkg/SKILL.md', content: 'hi' },
        { name: 'pkg/sub/x.txt', content: 'x' },
      ]),
    )
    const stripped = stripPrefix(fromZip).sort((a, b) => a.header.name.localeCompare(b.header.name))
    expect(stripped.map((e) => e.header.name)).toEqual(['SKILL.md', 'sub/x.txt'])
    expect(findSkillMd(stripped)?.data.toString()).toBe('hi')
    // Whatever came in, what gets stored is a tar.gz.
    const repacked = await repack(stripped)
    const roundTripped = await extractEntries(repacked)
    expect(roundTripped.map((e) => e.header.name).sort()).toEqual(['SKILL.md', 'sub/x.txt'])
  })
})

describe('stripPrefix', () => {
  it('strips owner-repo-sha/ prefix from all entries', async () => {
    const bytes = await buildTarGz([
      { name: 'owner-repo-abc123/', type: 'directory' },
      { name: 'owner-repo-abc123/SKILL.md', content: 'hi' },
      { name: 'owner-repo-abc123/sub/x.txt', content: 'x' },
    ])
    const entries = await extractEntries(bytes)
    const out = stripPrefix(entries)
    expect(out.map((e) => e.header.name)).toEqual(['SKILL.md', 'sub/x.txt'])
  })

  it('drops entries that do not share the detected prefix', async () => {
    const bytes = await buildTarGz([
      { name: 'pfx/a.txt', content: '' },
      { name: 'other/b.txt', content: '' },
    ])
    const entries = await extractEntries(bytes)
    expect(stripPrefix(entries).map((e) => e.header.name)).toEqual(['a.txt'])
  })

  it('returns empty array for empty input', () => {
    expect(stripPrefix([])).toEqual([])
  })

  it('drops root and slash-only names when no prefix detected', async () => {
    const bytes = await buildTarGz([
      { name: 'rootfile.txt', content: 'a' },
      { name: 'sub/x.txt', content: 'b' },
    ])
    const entries = await extractEntries(bytes)
    // First entry "rootfile.txt" has no slash → prefixDir = ''
    const out = stripPrefix(entries)
    expect(out.map((e) => e.header.name)).toEqual(['rootfile.txt', 'sub/x.txt'])
  })
})

describe('filterSubpath', () => {
  const sample = [
    { header: { name: 'a.txt', type: 'file' as const, mode: 0o644 }, data: Buffer.from('A') },
    { header: { name: 'lib/b.txt', type: 'file' as const, mode: 0o644 }, data: Buffer.from('B') },
    {
      header: { name: 'lib/sub/c.txt', type: 'file' as const, mode: 0o644 },
      data: Buffer.from('C'),
    },
    { header: { name: 'other/d.txt', type: 'file' as const, mode: 0o644 }, data: Buffer.from('D') },
  ]

  it('is a no-op when subpath is null', () => {
    expect(filterSubpath(sample, null)).toBe(sample)
  })

  it('scopes to subpath and strips the prefix from each name', () => {
    const out = filterSubpath(sample, 'lib')
    expect(out.map((e) => e.header.name)).toEqual(['b.txt', 'sub/c.txt'])
  })

  it('tolerates trailing slash in subpath', () => {
    const out = filterSubpath(sample, 'lib/')
    expect(out.map((e) => e.header.name)).toEqual(['b.txt', 'sub/c.txt'])
  })

  it('drops the subpath dir entry itself (name becomes empty)', () => {
    const withDir = [
      { header: { name: 'lib/', type: 'directory' as const, mode: 0o755 }, data: Buffer.alloc(0) },
      ...sample,
    ]
    const out = filterSubpath(withDir, 'lib')
    expect(out.map((e) => e.header.name)).toEqual(['b.txt', 'sub/c.txt'])
  })
})

describe('findSkillMd', () => {
  const skillFile = (name: string) => ({
    header: { name, type: 'file' as const, mode: 0o644 },
    data: Buffer.from('---\nname: x\n---\n'),
  })

  it('returns SKILL.md when present at root', () => {
    expect(findSkillMd([skillFile('SKILL.md')])?.header.name).toBe('SKILL.md')
  })

  it('returns lowercase skill.md when present at root', () => {
    expect(findSkillMd([skillFile('skill.md')])?.header.name).toBe('skill.md')
  })

  it('returns null when only nested SKILL.md exists', () => {
    expect(findSkillMd([skillFile('sub/SKILL.md')])).toBeNull()
  })

  it('returns null for empty input', () => {
    expect(findSkillMd([])).toBeNull()
  })

  it('ignores non-file entries with matching name', () => {
    expect(
      findSkillMd([
        {
          header: { name: 'SKILL.md', type: 'directory', mode: 0o755 },
          data: Buffer.alloc(0),
        },
      ]),
    ).toBeNull()
  })
})

describe('listNestedSkillDirs', () => {
  const f = (name: string) => ({
    header: { name, type: 'file' as const, mode: 0o644 },
    data: Buffer.alloc(0),
  })

  it('lists each nested skill dir', () => {
    expect(
      listNestedSkillDirs([f('foo/SKILL.md'), f('bar/baz/SKILL.md'), f('quux/readme.md')]),
    ).toEqual(['foo', 'bar/baz'])
  })

  it('ignores the root SKILL.md', () => {
    expect(listNestedSkillDirs([f('SKILL.md'), f('foo/SKILL.md')])).toEqual(['foo'])
  })

  it('returns empty when no SKILL.md present at all', () => {
    expect(listNestedSkillDirs([f('readme.md'), f('src/index.ts')])).toEqual([])
  })
})

describe('repack', () => {
  it('round-trips through extractEntries', async () => {
    const original = await buildTarGz([
      { name: 'SKILL.md', content: '---\nname: r\n---\n' },
      { name: 'sub/x.txt', content: 'xx' },
    ])
    const entries = await extractEntries(original)
    const repacked = await repack(entries)
    const reparsed = await extractEntries(repacked)
    expect(reparsed.map((e) => e.header.name).sort()).toEqual(['SKILL.md', 'sub/x.txt'].sort())
    const skill = reparsed.find((e) => e.header.name === 'SKILL.md')
    expect(skill?.data.toString()).toBe('---\nname: r\n---\n')
  })

  it('drops non-file / non-directory entries', async () => {
    // Synthesize a "symlink" header — repack should skip it
    const entries = [
      {
        header: { name: 'real.txt', type: 'file' as const, mode: 0o644 },
        data: Buffer.from('hi'),
      },
      {
        header: { name: 'link', type: 'symlink' as const, mode: 0o644, linkname: 'real.txt' },
        data: Buffer.alloc(0),
      },
    ]
    const out = await repack(entries)
    const reparsed = await extractEntries(out)
    expect(reparsed.map((e) => e.header.name)).toEqual(['real.txt'])
  })
})

describe('normalizeUploadToTarGz', () => {
  it('passes tar.gz through byte-for-byte', async () => {
    const bytes = await buildTarGz([{ name: 'SKILL.md', content: 'hi' }])
    const out = await normalizeUploadToTarGz(bytes)
    expect(out).toBe(bytes)
  })

  it('converts a zip into a tar.gz the rest of the pipeline can read', async () => {
    const out = await normalizeUploadToTarGz(
      buildZip([
        { name: 'SKILL.md', content: '---\nname: r\n---\n' },
        { name: 'sub/x.txt', content: 'x' },
      ]),
    )
    const entries = await extractEntries(out)
    expect(entries.map((e) => e.header.name).sort()).toEqual(['SKILL.md', 'sub/x.txt'])
    expect(findSkillMd(entries)?.data.toString()).toBe('---\nname: r\n---\n')
  })

  it('strips the wrapping dir a folder-compressed zip carries', async () => {
    const out = await normalizeUploadToTarGz(
      buildZip([
        { name: 'my-skill/SKILL.md', content: 'hi' },
        { name: 'my-skill/refs/a.md', content: 'a' },
      ]),
    )
    const entries = await extractEntries(out)
    expect(entries.map((e) => e.header.name).sort()).toEqual(['SKILL.md', 'refs/a.md'])
  })

  it('keeps a root SKILL.md even when a sibling dir exists', async () => {
    const out = await normalizeUploadToTarGz(
      buildZip([
        { name: 'SKILL.md', content: 'hi' },
        { name: 'refs/a.md', content: 'a' },
      ]),
    )
    const entries = await extractEntries(out)
    expect(entries.map((e) => e.header.name).sort()).toEqual(['SKILL.md', 'refs/a.md'])
  })

  it('leaves multiple top-level dirs alone', async () => {
    const out = await normalizeUploadToTarGz(
      buildZip([
        { name: 'a/SKILL.md', content: 'a' },
        { name: 'b/SKILL.md', content: 'b' },
      ]),
    )
    const entries = await extractEntries(out)
    expect(entries.map((e) => e.header.name).sort()).toEqual(['a/SKILL.md', 'b/SKILL.md'])
  })

  it('rejects a zip it cannot read', async () => {
    const zip = buildZip([{ name: 'SKILL.md', content: 'hi' }])
    await expect(normalizeUploadToTarGz(zip.subarray(0, zip.length - 8))).rejects.toBeTruthy()
  })

  it('leaves non-zip bytes to the existing tar.gz path', async () => {
    // Validation of tarball bytes has always happened downstream, not here.
    const junk = Buffer.from('PK nope')
    expect(await normalizeUploadToTarGz(junk)).toBe(junk)
  })
})
