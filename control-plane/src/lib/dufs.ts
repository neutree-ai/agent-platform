/**
 * Classify a dufs path as a file or directory.
 *
 * dufs's `?json` metadata endpoint is the only reliable discriminator: dufs
 * serves HTTP 200 for a *file* requested with a trailing slash, so trailing-
 * slash probing does NOT distinguish file from directory. `GET <path>?json`
 * returns a small JSON object in both cases (for a file it is metadata, not
 * the file body, so this is cheap even for large files):
 *   - directory → { kind: "Index", paths: [ ... ] }
 *   - file      → { path_type: "File", name, mtime, size }
 *
 * `fileUrl` is the dufs file URL without query, e.g.
 * `http://<agent>/files/out/2026-04`. Returns null when the path does not
 * exist (404). Throws on network error / non-404 upstream failure so callers
 * can map it to a 502.
 */
export async function classifyDufsPath(
  fileUrl: string,
  signal?: AbortSignal,
): Promise<'file' | 'dir' | null> {
  const res = await fetch(`${fileUrl}?json`, { signal })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`dufs returned ${res.status}`)
  const data = (await res.json().catch(() => null)) as {
    paths?: unknown
    path_type?: string
  } | null
  if (data && Array.isArray(data.paths)) return 'dir'
  if (data && data.path_type === 'File') return 'file'
  return null
}
