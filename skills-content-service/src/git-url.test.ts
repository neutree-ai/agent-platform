import { describe, expect, it } from 'vitest'
import { getTarballUrl, parseGitUrl } from './git-url'

describe('parseGitUrl', () => {
  it('parses a github.com full url', () => {
    const s = parseGitUrl('https://github.com/owner/repo')
    expect(s).toMatchObject({
      type: 'github',
      host: 'github.com',
      owner: 'owner',
      repo: 'repo',
      ref: null,
      subpath: null,
    })
  })

  it('extracts ref + subpath from /tree/<branch>/<path> on github', () => {
    const s = parseGitUrl('https://github.com/o/r/tree/main/lib/skills')
    expect(s.ref).toBe('main')
    expect(s.subpath).toBe('lib/skills')
  })

  it('extracts ref + subpath from /-/tree/<branch>/<path> on gitlab', () => {
    const s = parseGitUrl('https://gitlab.com/o/r/-/tree/develop/sub/dir')
    expect(s.type).toBe('gitlab')
    expect(s.ref).toBe('develop')
    expect(s.subpath).toBe('sub/dir')
  })

  it('accepts owner/repo shorthand and defaults to github', () => {
    const s = parseGitUrl('octocat/hello')
    expect(s).toMatchObject({
      type: 'github',
      host: 'github.com',
      owner: 'octocat',
      repo: 'hello',
      url: 'https://github.com/octocat/hello',
    })
  })

  it('extracts ref from shorthand with extra path component', () => {
    const s = parseGitUrl('octocat/hello/develop')
    expect(s.ref).toBe('develop')
  })

  it('strips trailing slash and .git suffix', () => {
    const s = parseGitUrl('https://github.com/o/r.git/')
    expect(s.repo).toBe('r')
    expect(s.url).toBe('https://github.com/o/r')
  })

  it('throws on invalid URL', () => {
    expect(() => parseGitUrl('not a url')).toThrow(/Invalid Git URL/)
  })

  it('throws when host has no recognizable type and explicitType is absent', () => {
    expect(() => parseGitUrl('https://example.com/o/r')).toThrow(/auto-detect/)
  })

  it('respects explicitType override', () => {
    const s = parseGitUrl('https://my-ent.example/o/r', 'github')
    expect(s.type).toBe('github')
    expect(s.host).toBe('my-ent.example')
  })

  it('throws on unsupported type', () => {
    expect(() => parseGitUrl('https://github.com/o/r', 'bitbucket')).toThrow(/Unsupported/)
  })

  it('throws when URL lacks owner/repo', () => {
    expect(() => parseGitUrl('https://github.com/')).toThrow(/owner\/repo/)
  })
})

describe('getTarballUrl', () => {
  it('builds an api.github.com tarball URL for github.com', () => {
    const s = parseGitUrl('https://github.com/o/r/tree/main')
    const { url, headers } = getTarballUrl(s, 'tok')
    expect(url).toBe('https://api.github.com/repos/o/r/tarball/main')
    expect(headers.Authorization).toBe('Bearer tok')
    expect(headers['User-Agent']).toBe('nap-skill-import')
  })

  it('uses /api/v3 for GitHub Enterprise', () => {
    const s = parseGitUrl('https://ghe.example.com/o/r', 'github')
    const { url } = getTarballUrl(s)
    expect(url).toBe('https://ghe.example.com/api/v3/repos/o/r/tarball/HEAD')
  })

  it('builds an /api/v4 archive URL for GitLab with PRIVATE-TOKEN', () => {
    const s = parseGitUrl('https://gitlab.com/o/r/-/tree/v1.0')
    const { url, headers } = getTarballUrl(s, 'glpat-xyz')
    expect(url).toBe('https://gitlab.com/api/v4/projects/o%2Fr/repository/archive.tar.gz?sha=v1.0')
    expect(headers['PRIVATE-TOKEN']).toBe('glpat-xyz')
    expect(headers.Authorization).toBeUndefined()
  })

  it('omits auth header when no token provided', () => {
    const s = parseGitUrl('https://github.com/o/r')
    const { headers } = getTarballUrl(s)
    expect(headers.Authorization).toBeUndefined()
  })

  it('defaults ref to HEAD when source.ref is null', () => {
    const s = parseGitUrl('https://github.com/o/r')
    expect(getTarballUrl(s).url).toBe('https://api.github.com/repos/o/r/tarball/HEAD')
  })
})
