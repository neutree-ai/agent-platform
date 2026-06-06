/**
 * Per-source mutable scratch directory for native draft editing.
 *
 * Layout: `<CACHE_DIR>/draft/<sourceId>/...`
 *
 * Authority: `skill_sources.draft_package` in the DB is the source of truth.
 * The scratch dir is a working copy. Every write goes:
 *
 *   1. apply to scratch (write/unlink the file)
 *   2. repack scratch → tar.gz buffer
 *   3. UPDATE skill_sources SET draft_package = $tarball
 *
 * If step 3 fails the disk state is ahead of DB; the next pod restart
 * re-hydrates from DB and discards the drift. This is acceptable because
 * the editor is a single-writer-per-source path.
 *
 * Hydration order on cache miss:
 *   - `draft_package` present → unpack it
 *   - else if the source's skill has an `active_version_id` → unpack the
 *     active version's package as a baseline (so opening Edit on a
 *     published-without-draft skill shows the user the current files)
 *   - else → empty dir (brand-new native skill, no baseline)
 *
 * This module does not participate in the LRU sweep (see lru.ts). Drafts are
 * naturally few — at most one per native source, cleared on publish/discard —
 * and persisting stale dirs is harmless until pod restart.
 */
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, posix, resolve, sep } from 'node:path'
import { pool } from './db'
import {
  getActiveVersionPackage,
  getDraftPackage,
  listSkillsBySource,
} from './db'
import { repack } from './skill-tar'
import { collectDirAsEntries, extractTarGzToDir } from './tar-io'

const CACHE_DIR = process.env.CACHE_DIR || '/var/cache/skills-content'

const SAFE_UUID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function assertSafeId(sourceId: string): void {
  if (!SAFE_UUID.test(sourceId)) throw new Error(`unsafe source id: ${sourceId}`)
}

function draftDir(sourceId: string): string {
  return join(CACHE_DIR, 'draft', sourceId)
}

// Sibling sentinel file holding the hash of the bytes we last extracted
// from. Re-read on hydrate to detect when a peer pod (or our own past
// life) wrote a newer draft to DB after we cached this scratch dir.
// Kept next to the scratch dir (NOT inside) so it can't slip into the
// repacked tarball via collectDirAsEntries.
function sentinelPath(sourceId: string): string {
  return join(CACHE_DIR, 'draft', `${sourceId}.sentinel`)
}

function shortHash(bytes: Buffer | null): string {
  if (!bytes || bytes.byteLength === 0) return 'empty'
  return createHash('sha256').update(bytes).digest('hex')
}

const inflight = new Map<string, Promise<void>>()

async function dirExists(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory()
  } catch {
    return false
  }
}

/**
 * Bring the scratch dir in sync with DB. Re-extracts whenever the disk
 * sentinel (hash of the bytes we last extracted from) doesn't match what
 * the DB currently holds — that's how we catch the cross-pod case where
 * another replica wrote a newer draft after we cached the dir.
 */
async function hydrate(sourceId: string): Promise<void> {
  assertSafeId(sourceId)
  const existing = inflight.get(sourceId)
  if (existing) return existing

  const work = (async () => {
    const finalDir = draftDir(sourceId)
    // Resolve the bytes we'd extract from — same precedence as before:
    // draft_package wins; else fall back to the source's first skill's
    // active version package; else empty dir.
    const draft = await getDraftPackage(sourceId)
    let bytes: Buffer | null = draft
    if (!bytes) {
      const skills = await listSkillsBySource(sourceId)
      for (const s of skills) {
        if (!s.active_version_id) continue
        const av = await getActiveVersionPackage(s.id)
        if (av) {
          bytes = av.package
          break
        }
      }
    }
    const expected = shortHash(bytes)
    // Fast path: dir exists and sentinel matches the bytes we'd extract.
    if (await dirExists(finalDir)) {
      const onDisk = await readFile(sentinelPath(sourceId), 'utf8').catch(() => null)
      if (onDisk === expected) return
      // Stale — blow it away and re-extract.
      await rm(finalDir, { recursive: true, force: true })
    }

    const tmp = join(CACHE_DIR, 'draft', `.tmp-${randomBytes(8).toString('hex')}`)
    await mkdir(tmp, { recursive: true })
    try {
      if (bytes && bytes.byteLength > 0) {
        await extractTarGzToDir(bytes, tmp)
      }
      try {
        await rename(tmp, finalDir)
      } catch (err) {
        await rm(tmp, { recursive: true, force: true })
        if (!(await dirExists(finalDir))) throw err
      }
      // Write sentinel AFTER the dir is in place. Ordering matters on a
      // hard restart between these two steps: a missing sentinel just
      // forces a single re-extract on next access, which is harmless.
      await writeFile(sentinelPath(sourceId), expected).catch(() => {})
    } catch (err) {
      await rm(tmp, { recursive: true, force: true }).catch(() => {})
      throw err
    }
  })().finally(() => {
    inflight.delete(sourceId)
  })

  inflight.set(sourceId, work)
  return work
}

/**
 * Validate + canonicalize a client-supplied draft path. Rejects:
 * - empty / whitespace
 * - absolute paths
 * - any segment containing `..`
 * Returns the cleaned relative path (forward slashes) or null on rejection.
 */
function sanitizeDraftPath(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  // Normalize separators to posix; reject any windows-style absolute paths.
  const candidate = trimmed.replace(/\\/g, '/')
  if (candidate.startsWith('/')) return null
  const parts = candidate.split('/').filter(Boolean)
  for (const p of parts) {
    if (p === '..' || p === '.') return null
  }
  if (parts.length === 0) return null
  return parts.join('/')
}

function absUnder(sourceId: string, relPath: string): string | null {
  const root = draftDir(sourceId)
  const full = resolve(root, relPath.split(posix.sep).join(sep))
  if (full !== root && !full.startsWith(root + sep)) return null
  return full
}

interface DraftFileNode {
  path: string
  type: 'file' | 'dir'
  size?: number
}

export async function listDraftTree(sourceId: string): Promise<DraftFileNode[]> {
  await hydrate(sourceId)
  const root = draftDir(sourceId)
  const out: DraftFileNode[] = []
  await walk(root, root, out)
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

async function walk(root: string, dir: string, out: DraftFileNode[]): Promise<void> {
  let entries: { name: string; isDir: boolean; isFile: boolean }[]
  try {
    const raw = await import('node:fs/promises').then((m) => m.readdir(dir, { withFileTypes: true }))
    entries = raw.map((e) => ({ name: e.name, isDir: e.isDirectory(), isFile: e.isFile() }))
  } catch {
    return
  }
  for (const e of entries) {
    if (e.name.startsWith('.tmp-')) continue
    const full = join(dir, e.name)
    const rel = full.slice(root.length + 1).split(sep).join('/')
    if (e.isDir) {
      out.push({ path: rel, type: 'dir' })
      await walk(root, full, out)
    } else if (e.isFile) {
      const st = await stat(full)
      out.push({ path: rel, type: 'file', size: st.size })
    }
  }
}

export async function readDraftFile(sourceId: string, path: string): Promise<Buffer | null> {
  const safe = sanitizeDraftPath(path)
  if (!safe) return null
  await hydrate(sourceId)
  const full = absUnder(sourceId, safe)
  if (!full) return null
  try {
    return await readFile(full)
  } catch (e: any) {
    if (e.code === 'ENOENT') return null
    throw e
  }
}

/**
 * Write `content` to the draft at `path` and persist the repacked tar.gz to
 * `skill_sources.draft_package`. Path is validated against escape.
 */
export async function writeDraftFile(
  sourceId: string,
  path: string,
  content: Buffer,
): Promise<{ byteCount: number }> {
  const safe = sanitizeDraftPath(path)
  if (!safe) throw new DraftPathError('invalid path')
  await hydrate(sourceId)
  const full = absUnder(sourceId, safe)
  if (!full) throw new DraftPathError('invalid path')
  await mkdir(dirname(full), { recursive: true })
  const { writeFile } = await import('node:fs/promises')
  await writeFile(full, content)
  return persistToDb(sourceId)
}

export async function deleteDraftFile(sourceId: string, path: string): Promise<boolean> {
  const safe = sanitizeDraftPath(path)
  if (!safe) throw new DraftPathError('invalid path')
  await hydrate(sourceId)
  const full = absUnder(sourceId, safe)
  if (!full) throw new DraftPathError('invalid path')
  try {
    await unlink(full)
  } catch (e: any) {
    if (e.code === 'ENOENT') return false
    throw e
  }
  await persistToDb(sourceId)
  return true
}

async function persistToDb(sourceId: string): Promise<{ byteCount: number }> {
  const entries = await collectDirAsEntries(draftDir(sourceId))
  const tarball = await repack(entries)
  await pool.query(
    `UPDATE skill_sources SET draft_package = $1, updated_at = NOW()
      WHERE id = $2 AND kind = 'native'`,
    [tarball, sourceId],
  )
  // Refresh sentinel so same-pod follow-up reads skip re-extraction.
  // Peer pods still see their own sentinel as stale and re-extract.
  await writeFile(sentinelPath(sourceId), shortHash(tarball)).catch(() => {})
  return { byteCount: tarball.byteLength }
}

/** Remove the scratch dir + sentinel; called after publish/discard. Idempotent. */
export async function clearDraftScratch(sourceId: string): Promise<void> {
  await Promise.all([
    rm(draftDir(sourceId), { recursive: true, force: true }),
    rm(sentinelPath(sourceId), { force: true }),
  ])
}

export class DraftPathError extends Error {}
