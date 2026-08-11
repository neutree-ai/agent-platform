/**
 * Pure archive operations for skill packages.
 *
 * Pipeline (composed by the service):
 *   bytes
 *     → extractEntries → entries
 *     → stripPrefix    → entries without `owner-repo-sha/` prefix dir
 *     → filterSubpath  → entries scoped to a subpath (optional)
 *     → repack         → clean tar.gz buffer
 *
 * Uploads arrive as either tar.gz or zip; `extractEntries` normalizes both to
 * the same entry list, so everything downstream — and the stored package,
 * which `repack` always writes as tar.gz — is archive-format agnostic.
 *
 * I/O lives outside (the GitSourceClient fetches the bytes; the service
 * orchestrates these steps). Tar/gzip streams are still asynchronous via
 * Node streams, but no network or filesystem touch happens here.
 */
import { createGunzip, createGzip } from 'node:zlib'
import { unzipSync } from 'fflate'
import { type Headers, extract, pack } from 'tar-stream'

export interface TarEntry {
  header: Headers
  data: Buffer
}

/** Local file header signature — the first bytes of any non-empty zip. */
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]

function isZip(bytes: Buffer): boolean {
  return bytes.length >= 4 && ZIP_MAGIC.every((b, i) => bytes[i] === b)
}

/**
 * Parse a tar.gz or zip buffer into entries, dispatching on the magic bytes
 * rather than on a filename or a client-supplied content type — neither is
 * trustworthy, and both are absent on the git-import path.
 */
export function extractEntries(archiveBytes: Buffer): Promise<TarEntry[]> {
  return isZip(archiveBytes) ? extractZipEntries(archiveBytes) : extractTarGzEntries(archiveBytes)
}

/** Parse a tar.gz buffer into entries. Streams gunzip + tar-extract in-memory. */
function extractTarGzEntries(tarballBytes: Buffer): Promise<TarEntry[]> {
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
 * Names a zip carries that are archiver bookkeeping, not skill content.
 * macOS Finder's "Compress" writes an `__MACOSX/` tree of `._name` resource
 * forks alongside every file; keeping them would put junk in the skill and let
 * `__MACOSX/._SKILL.md` masquerade as a skill entry point.
 */
function isArchiverNoise(name: string): boolean {
  const parts = name.split('/')
  return parts.some((p) => p === '__MACOSX' || p === '.DS_Store' || p.startsWith('._'))
}

/**
 * Parse a zip buffer into the same shape `extractTarGzEntries` produces.
 *
 * Zip carries no unix mode we can rely on across the writers users actually
 * use (Finder, Explorer, `zip`), so entries take the same defaults `repack`
 * would apply anyway. Directory entries are recognized by the trailing slash
 * that the format mandates for them.
 */
function extractZipEntries(zipBytes: Buffer): Promise<TarEntry[]> {
  return new Promise<TarEntry[]>((resolve, reject) => {
    let files: Record<string, Uint8Array>
    try {
      files = unzipSync(zipBytes)
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)))
      return
    }
    const entries: TarEntry[] = []
    for (const [name, data] of Object.entries(files)) {
      if (!name || isArchiverNoise(name)) continue
      if (name.endsWith('/')) {
        entries.push({
          header: { name, type: 'directory', mode: 0o755 },
          data: Buffer.alloc(0),
        })
      } else {
        const buf = Buffer.from(data)
        entries.push({
          header: { name, type: 'file', size: buf.length, mode: 0o644 },
          data: buf,
        })
      }
    }
    resolve(entries)
  })
}

/**
 * Convert an uploaded package to the tar.gz that everything downstream
 * assumes: the stored `skill_versions.package` bytes are served verbatim to
 * agents and gunzipped by the draft cache, so a zip has to be rewritten before
 * it is persisted, not merely readable.
 *
 * tar.gz input is returned untouched — byte-identical, no repack — so the
 * existing upload path keeps behaving exactly as before.
 *
 * Zip input additionally loses a single wrapping directory when the archive
 * has one and no SKILL.md at its root. Compressing a skill folder in Finder or
 * Explorer always produces `skill-name/SKILL.md`, whereas the documented tar
 * invocation (`tar -czf … -C skill-dir .`) produces a root-level SKILL.md;
 * stripping reconciles the two so the obvious way to make a zip works.
 */
export async function normalizeUploadToTarGz(bytes: Buffer): Promise<Buffer> {
  if (!isZip(bytes)) return bytes
  const entries = await extractZipEntries(bytes)
  return repack(hasSingleWrappingDir(entries) ? stripPrefix(entries) : entries)
}

/** True when every entry sits under one shared top-level dir and no root SKILL.md exists. */
function hasSingleWrappingDir(entries: TarEntry[]): boolean {
  if (entries.length === 0) return false
  if (findSkillMd(entries)) return false
  const first = entries[0].header.name
  const slashIdx = first.indexOf('/')
  if (slashIdx <= 0) return false
  const prefix = first.slice(0, slashIdx + 1)
  return entries.every((e) => e.header.name.startsWith(prefix))
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
