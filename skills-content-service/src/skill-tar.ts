/**
 * Pure tarball operations for skill packages.
 *
 * Pipeline (composed by the service):
 *   bytes
 *     → extractEntries → entries
 *     → stripPrefix    → entries without `owner-repo-sha/` prefix dir
 *     → filterSubpath  → entries scoped to a subpath (optional)
 *     → repack         → clean tar.gz buffer
 *
 * I/O lives outside (the GitSourceClient fetches the bytes; the service
 * orchestrates these steps). Tar/gzip streams are still asynchronous via
 * Node streams, but no network or filesystem touch happens here.
 */
import { createGunzip, createGzip } from 'node:zlib'
import { type Headers, extract, pack } from 'tar-stream'

export interface TarEntry {
  header: Headers
  data: Buffer
}

/** Parse a tar.gz buffer into entries. Streams gunzip + tar-extract in-memory. */
export function extractEntries(tarballBytes: Buffer): Promise<TarEntry[]> {
  return new Promise<TarEntry[]>((resolve, reject) => {
    const entries: TarEntry[] = []
    const ex = extract()

    ex.on('entry', (header, stream, next) => {
      const bufs: Buffer[] = []
      stream.on('data', (d: Buffer) => bufs.push(d))
      stream.on('end', () => {
        entries.push({ header, data: Buffer.concat(bufs) })
        next()
      })
      stream.on('error', next)
    })
    ex.on('finish', () => resolve(entries))
    ex.on('error', reject)

    const gunzip = createGunzip()
    gunzip.on('error', reject)
    gunzip.pipe(ex)
    gunzip.end(tarballBytes)
  })
}

/**
 * GitHub/GitLab tarballs wrap everything under a top-level dir like
 * `owner-repo-sha/`. Detect it from the first entry and strip it from every
 * entry's name; drop entries that don't share the prefix (and the prefix dir
 * itself, which becomes name="").
 */
export function stripPrefix(entries: TarEntry[]): TarEntry[] {
  if (entries.length === 0) return []

  const first = entries[0].header.name
  const slashIdx = first.indexOf('/')
  const prefixDir = slashIdx > 0 ? first.slice(0, slashIdx + 1) : ''
  if (!prefixDir) return entries.filter((e) => e.header.name !== '' && e.header.name !== '/')

  const out: TarEntry[] = []
  for (const entry of entries) {
    const name = entry.header.name
    if (!name.startsWith(prefixDir)) continue
    const stripped = name.slice(prefixDir.length)
    if (!stripped || stripped === '/') continue
    out.push({ header: { ...entry.header, name: stripped }, data: entry.data })
  }
  return out
}

/**
 * Scope entries to a subpath. The subpath itself is removed from each
 * entry name; entries outside the subpath are dropped. `null` is a no-op.
 */
export function filterSubpath(entries: TarEntry[], subpath: string | null): TarEntry[] {
  if (!subpath) return entries
  const prefix = subpath.endsWith('/') ? subpath : `${subpath}/`
  const out: TarEntry[] = []
  for (const entry of entries) {
    const name = entry.header.name
    if (!name.startsWith(prefix)) continue
    const stripped = name.slice(prefix.length)
    if (!stripped) continue
    out.push({ header: { ...entry.header, name: stripped }, data: entry.data })
  }
  return out
}

/** Find a root-level SKILL.md (case-insensitive on the filename, not on the dir). */
export function findSkillMd(entries: TarEntry[]): TarEntry | null {
  for (const entry of entries) {
    if (entry.header.type !== 'file') continue
    if (entry.header.name === 'SKILL.md' || entry.header.name === 'skill.md') return entry
  }
  return null
}

/**
 * Find directories that contain a SKILL.md (or skill.md) one level deep or
 * deeper. Used to produce a helpful "you forgot the subpath" error when the
 * caller imported a multi-skill repo without choosing one.
 */
export function listNestedSkillDirs(entries: TarEntry[]): string[] {
  const dirs: string[] = []
  for (const entry of entries) {
    if (entry.header.type !== 'file') continue
    const name = entry.header.name
    const lower = name.toLowerCase()
    if (lower === 'skill.md') continue // root SKILL.md is handled by findSkillMd
    if (!lower.endsWith('/skill.md')) continue
    const dir = name.slice(0, name.lastIndexOf('/'))
    if (dir) dirs.push(dir)
  }
  return dirs
}

/** Re-emit entries as a fresh tar.gz. Only file + directory entry types survive. */
export function repack(entries: TarEntry[]): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const p = pack()
    const chunks: Buffer[] = []
    const gzip = createGzip()

    gzip.on('data', (chunk: Buffer) => chunks.push(chunk))
    gzip.on('end', () => resolve(Buffer.concat(chunks)))
    gzip.on('error', reject)
    p.on('error', reject)

    p.pipe(gzip)

    for (const entry of entries) {
      if (entry.header.type === 'file') {
        p.entry(
          { name: entry.header.name, size: entry.data.length, mode: entry.header.mode },
          entry.data,
        )
      } else if (entry.header.type === 'directory') {
        p.entry({ name: entry.header.name, type: 'directory', mode: entry.header.mode })
      }
    }

    p.finalize()
  })
}
