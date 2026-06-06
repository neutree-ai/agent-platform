/**
 * Pure git URL parsing + per-host tarball URL construction.
 *
 * Each git hosting type (github, gitlab, ...) has an adapter describing
 * how to parse `/tree/ref/subpath` URL fragments and how to build its
 * tarball REST URL. New types are registered into ADAPTERS without touching
 * schema or API.
 *
 * I/O (commit-sha fetch) lives in the GitSourceClient adapter, not here.
 */

export interface ParsedGitSource {
  type: string
  url: string
  host: string
  protocol: string
  owner: string
  repo: string
  ref: string | null
  subpath: string | null
}

interface GitAdapter {
  /**
   * Extract `ref` and `subpath` from URL path components after `owner/repo`.
   * GitHub: /tree/ref/sub; GitLab: /-/tree/ref/sub.
   */
  parsePathExtras(pathParts: string[]): { ref: string | null; subpath: string | null }
  buildTarballRequest(
    source: ParsedGitSource,
    token?: string,
  ): { url: string; headers: Record<string, string> }
}

const githubAdapter: GitAdapter = {
  parsePathExtras(pathParts) {
    if (pathParts[2] === 'tree' && pathParts.length > 3) {
      return {
        ref: pathParts[3],
        subpath: pathParts.length > 4 ? pathParts.slice(4).join('/') : null,
      }
    }
    return { ref: null, subpath: null }
  },
  buildTarballRequest(source, token) {
    const ref = source.ref || 'HEAD'
    const proto = source.protocol || 'https:'
    // github.com → api.github.com; GitHub Enterprise → {host}/api/v3
    const base =
      source.host === 'github.com' ? 'https://api.github.com' : `${proto}//${source.host}/api/v3`
    const url = `${base}/repos/${source.owner}/${source.repo}/tarball/${ref}`
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'nap-skill-import',
    }
    if (token) headers.Authorization = `Bearer ${token}`
    return { url, headers }
  },
}

const gitlabAdapter: GitAdapter = {
  parsePathExtras(pathParts) {
    if (pathParts[2] === '-' && pathParts[3] === 'tree' && pathParts.length > 4) {
      return {
        ref: pathParts[4],
        subpath: pathParts.length > 5 ? pathParts.slice(5).join('/') : null,
      }
    }
    return { ref: null, subpath: null }
  },
  buildTarballRequest(source, token) {
    const ref = source.ref || 'HEAD'
    const proto = source.protocol || 'https:'
    const projectId = encodeURIComponent(`${source.owner}/${source.repo}`)
    const url = `${proto}//${source.host}/api/v4/projects/${projectId}/repository/archive.tar.gz?sha=${encodeURIComponent(ref)}`
    const headers: Record<string, string> = {}
    if (token) headers['PRIVATE-TOKEN'] = token
    return { url, headers }
  },
}

const ADAPTERS: Record<string, GitAdapter> = {
  github: githubAdapter,
  gitlab: gitlabAdapter,
}

/** Best-effort host → type heuristic, used when the caller didn't supply an explicit type. */
function detectType(host: string): string {
  const h = host.toLowerCase()
  if (h.includes('github')) return 'github'
  if (h.includes('gitlab')) return 'gitlab'
  throw new Error(
    `Cannot auto-detect git host type for "${host}". Please specify the service type (GitHub or GitLab) explicitly.`,
  )
}

function getAdapter(type: string): GitAdapter {
  const a = ADAPTERS[type]
  if (!a) throw new Error(`Unsupported git source type: ${type}`)
  return a
}

/**
 * Parse a Git URL into its components.
 * Handles:
 *   https://github.com/owner/repo/tree/branch/path
 *   https://gitlab.com/owner/repo/-/tree/branch/path
 *   owner/repo  (shorthand, defaults to github.com)
 *
 * If `explicitType` is omitted, type is inferred from host via `detectType`.
 */
export function parseGitUrl(input: string, explicitType?: string): ParsedGitSource {
  let url = input.trim()

  // Shorthand: owner/repo (defaults to github.com)
  if (!url.includes('://') && !url.includes('.') && url.includes('/')) {
    const parts = url.split('/')
    if (parts.length >= 2) {
      return {
        type: explicitType ?? 'github',
        url: `https://github.com/${url}`,
        host: 'github.com',
        protocol: 'https:',
        owner: parts[0],
        repo: parts[1],
        ref: parts.length > 2 ? parts.slice(2).join('/') : null,
        subpath: null,
      }
    }
  }

  // Remove trailing slash and .git suffix
  url = url.replace(/\/+$/, '').replace(/\.git$/, '')

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`Invalid Git URL: ${input}`)
  }

  const host = parsed.hostname
  const protocol = parsed.protocol
  const pathParts = parsed.pathname.replace(/^\//, '').split('/')

  if (pathParts.length < 2) {
    throw new Error('Invalid Git URL: must contain owner/repo')
  }

  const owner = pathParts[0]
  const repo = pathParts[1]
  const type = explicitType ?? detectType(host)
  const adapter = getAdapter(type)
  const { ref, subpath } = adapter.parsePathExtras(pathParts)

  return {
    type,
    url: `${protocol}//${host}/${owner}/${repo}`,
    host,
    protocol,
    owner,
    repo,
    ref,
    subpath,
  }
}

/** Build tarball download URL + headers for the given source. */
export function getTarballUrl(
  source: ParsedGitSource,
  token?: string,
): { url: string; headers: Record<string, string> } {
  return getAdapter(source.type).buildTarballRequest(source, token)
}
