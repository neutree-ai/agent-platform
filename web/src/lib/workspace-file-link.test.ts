import { describe, expect, it } from 'vitest'
import { parseWorkspaceFileHref } from './workspace-file-link'

describe('parseWorkspaceFileHref', () => {
  it('returns null for nullish or non-workspace hrefs', () => {
    expect(parseWorkspaceFileHref(undefined)).toBeNull()
    expect(parseWorkspaceFileHref(null)).toBeNull()
    expect(parseWorkspaceFileHref('')).toBeNull()
    expect(parseWorkspaceFileHref('https://example.com/foo')).toBeNull()
    expect(parseWorkspaceFileHref('/etc/passwd')).toBeNull()
  })

  it('parses /workspace/* as the workspace drive', () => {
    expect(parseWorkspaceFileHref('/workspace/foo/bar.md')).toEqual({
      drive: 'workspace',
      filePath: '/foo/bar.md',
      viewingLine: undefined,
      viewingColumn: undefined,
    })
  })

  it('parses /mnt/afs/* as the afs drive', () => {
    expect(parseWorkspaceFileHref('/mnt/afs/share/doc.txt')).toEqual({
      drive: 'afs',
      filePath: '/share/doc.txt',
      viewingLine: undefined,
      viewingColumn: undefined,
    })
  })

  it('preserves a trailing slash so callers can detect directories', () => {
    const parsed = parseWorkspaceFileHref('/workspace/foo/')
    expect(parsed?.filePath).toBe('/foo/')
  })

  it('extracts :line and :line:col IDE anchors', () => {
    expect(parseWorkspaceFileHref('/workspace/foo/bar.ts:42')).toMatchObject({
      filePath: '/foo/bar.ts',
      viewingLine: 42,
      viewingColumn: undefined,
    })
    expect(parseWorkspaceFileHref('/workspace/foo/bar.ts:42:5')).toMatchObject({
      filePath: '/foo/bar.ts',
      viewingLine: 42,
      viewingColumn: 5,
    })
  })

  it('does not split filenames whose colon is not preceded by a `.ext`', () => {
    // `report:01` has no extension before the colon, so leave the path alone.
    const parsed = parseWorkspaceFileHref('/workspace/notes/report:01')
    expect(parsed?.filePath).toBe('/notes/report:01')
    expect(parsed?.viewingLine).toBeUndefined()
  })

  it('decodes percent-encoded CJK filenames once', () => {
    // "你好.md" percent-encoded.
    const href = `/workspace/${encodeURIComponent('你好.md')}`
    expect(parseWorkspaceFileHref(href)?.filePath).toBe('/你好.md')
  })

  it('survives malformed percent-encoding without throwing', () => {
    const parsed = parseWorkspaceFileHref('/workspace/bad%E0.md')
    expect(parsed).not.toBeNull()
    expect(parsed?.drive).toBe('workspace')
  })

  it('keeps the afs drive distinct from a workspace path that happens to contain "mnt/afs"', () => {
    expect(parseWorkspaceFileHref('/workspace/mnt/afs/x.md')?.drive).toBe('workspace')
  })
})
