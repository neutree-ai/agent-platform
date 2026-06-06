/**
 * Outbound HTTP to the git host (tarball download + commit SHA lookup).
 * The tar/gzip pipeline is not here; bytes in / bytes out only. Composed
 * with the pure helpers in `skill-tar.ts` by the route handlers.
 */
import { EnvHttpProxyAgent, interceptors, request } from 'undici'
import type { ParsedGitSource } from './git-url'

interface GitSourceClient {
  /**
   * Download a tarball from the given URL with the given auth/UA headers.
   * Returns the raw bytes — gunzip + extract happen in the service.
   *
   * Throws on non-200; the message includes a truncated body preview to make
   * upstream failures (auth, rate limit) diagnosable from the route response.
   */
  fetchTarball(url: string, headers: Record<string, string>): Promise<Buffer>

  /**
   * Best-effort latest-commit-SHA lookup. Returns null when unsupported by
   * the host (e.g. GitLab in the current impl) or on any non-fatal error —
   * the caller falls back to fetching the tarball and using whatever SHA the
   * tarball's prefix dir embeds.
   */
  fetchCommitSha(source: ParsedGitSource, token?: string): Promise<string | null>
}

// Shared dispatcher: respect http_proxy/https_proxy env vars and follow up to 5 redirects.
// Same configuration as the previous `lib/tarball.ts#tarballDispatcher` — preserved
// verbatim so import behavior in self-hosted environments doesn't change.
const tarballDispatcher = new EnvHttpProxyAgent().compose(
  interceptors.redirect({ maxRedirections: 5 }),
)

export class UndiciGitSourceClient implements GitSourceClient {
  async fetchTarball(url: string, headers: Record<string, string>): Promise<Buffer> {
    // Use undici.request rather than the global fetch: undici's fetch always
    // injects sec-fetch-mode=cors, which GitLab's nginx rejects with 406 on
    // archive endpoints. request() is the lower-level API and skips that header.
    const res = await request(url, { headers, dispatcher: tarballDispatcher })
    if (res.statusCode !== 200) {
      const text = await res.body.text().catch(() => '')
      throw new Error(`Failed to download tarball (${res.statusCode}): ${text.slice(0, 200)}`)
    }
    return Buffer.from(await res.body.arrayBuffer())
  }

  async fetchCommitSha(source: ParsedGitSource, token?: string): Promise<string | null> {
    if (source.type === 'github') return this.fetchGithubSha(source, token)
    if (source.type === 'gitlab') return this.fetchGitlabSha(source, token)
    return null
  }

  private async fetchGithubSha(source: ParsedGitSource, token?: string): Promise<string | null> {
    const ref = source.ref || 'HEAD'
    const proto = source.protocol || 'https:'
    const base =
      source.host === 'github.com' ? 'https://api.github.com' : `${proto}//${source.host}/api/v3`
    const url = `${base}/repos/${source.owner}/${source.repo}/commits/${encodeURIComponent(ref)}`
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.sha',
      'User-Agent': 'nap-skill-import',
    }
    if (token) headers.Authorization = `Bearer ${token}`
    try {
      const res = await fetch(url, { headers })
      if (!res.ok) return null
      const text = await res.text()
      return text.trim() || null
    } catch {
      return null
    }
  }

  private async fetchGitlabSha(source: ParsedGitSource, token?: string): Promise<string | null> {
    // GitLab v4: GET /projects/:id/repository/commits/:ref where :id is the
    // URL-encoded `owner/repo` path. Default branch is implicit when ref is
    // omitted — we still pass it explicitly when present to match the
    // tarball download path.
    const ref = source.ref || 'HEAD'
    const proto = source.protocol || 'https:'
    const base = `${proto}//${source.host}/api/v4`
    const projectId = encodeURIComponent(`${source.owner}/${source.repo}`)
    const url = `${base}/projects/${projectId}/repository/commits/${encodeURIComponent(ref)}`
    const headers: Record<string, string> = { 'User-Agent': 'nap-skill-import' }
    if (token) headers['PRIVATE-TOKEN'] = token
    try {
      const res = await fetch(url, { headers })
      if (!res.ok) return null
      const body = (await res.json().catch(() => null)) as { id?: string } | null
      const id = body?.id
      return typeof id === 'string' && id ? id : null
    } catch {
      return null
    }
  }
}
