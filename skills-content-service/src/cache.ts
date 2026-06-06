/**
 * Unpack cache.
 *
 * Layout: `<CACHE_DIR>/<skillId>/<versionKey>/...` where versionKey is the
 * `content_hash` from `skill_versions` (a generated column = sha256 of
 * `package`). When the skill's active version changes, the hash advances and
 * we land on a fresh directory; the old version dir stays until the LRU sweep
 * evicts it (per-skill cap + global high-water + orphan reap — see lru.ts).
 *
 * Pre-p3 we keyed on the skill's `name`; the column was globally unique. p3
 * dropped that uniqueness (now `UNIQUE(user_id, name)`) so we key on the
 * UUID instead. Path segments stay filesystem-safe by construction.
 */
import { randomBytes } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, normalize, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import { extract as tarExtract } from 'tar-stream'

const CACHE_DIR = process.env.CACHE_DIR || '/var/cache/skills-content'

// Skill ids are UUIDs and version keys are sha256 hex. Both fit safely in
// this whitelist; defense-in-depth against anything weird leaking in.
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function assertSafeSegment(label: string, value: string) {
  if (!SAFE_SEGMENT.test(value)) {
    throw new Error(`unsafe ${label}: ${value}`)
  }
}

function versionDir(skillId: string, key: string): string {
  return join(CACHE_DIR, skillId, key)
}

const inflight = new Map<string, Promise<string | null>>()

/**
 * Whether `<skillId>/<key>` is currently being unpacked. The LRU sweep
 * consults this so it doesn't rip a dir out from under an in-progress write.
 */
export function isInflight(skillId: string, key: string): boolean {
  return inflight.has(`${skillId}/${key}`)
}

/**
 * Ensures `<CACHE_DIR>/<skillId>/<key>` is populated and returns its path.
 *
 * `key` is the cache version segment — `content_hash` from `skill_versions`.
 * It's a generated NOT NULL column, so the caller always has one.
 *
 * `fetchBytes` is invoked only on a cache miss. It returns `null` if the
 * skill/version disappeared between the meta probe and the bytes read; we
 * propagate that as `null` too.
 */
export async function ensureUnpacked(
  skillId: string,
  key: string,
  fetchBytes: () => Promise<Buffer | null>,
): Promise<string | null> {
  assertSafeSegment('skill id', skillId)
  assertSafeSegment('version key', key)
  const finalDir = versionDir(skillId, key)

  // Fast path: already unpacked. Touch the access marker for future LRU.
  if (await dirExists(finalDir)) {
    touchAccess(finalDir).catch(() => {})
    return finalDir
  }

  const cacheKey = `${skillId}/${key}`
  const existing = inflight.get(cacheKey)
  if (existing) {
    console.log(`[skills-content] cache: joining in-flight unpack id=${skillId} version=${key}`)
    return existing
  }

  const work = (async () => {
    if (await dirExists(finalDir)) return finalDir
    console.log(`[skills-content] cache: miss id=${skillId} version=${key} — fetching bytes`)
    const fetchStart = Date.now()
    const bytes = await fetchBytes()
    if (!bytes) {
      console.warn(`[skills-content] cache: bytes vanished id=${skillId} version=${key}`)
      return null
    }
    console.log(
      `[skills-content] cache: fetched id=${skillId} bytes=${bytes.byteLength} in=${Date.now() - fetchStart}ms`,
    )
    const tmpDir = join(CACHE_DIR, skillId, `.tmp-${randomBytes(8).toString('hex')}`)
    await mkdir(tmpDir, { recursive: true })
    const extractStart = Date.now()
    let fileCount = 0
    try {
      fileCount = await extractTarGz(bytes, tmpDir)
      const extractMs = Date.now() - extractStart
      try {
        await rename(tmpDir, finalDir)
      } catch (err) {
        await rm(tmpDir, { recursive: true, force: true })
        if (!(await dirExists(finalDir))) throw err
        console.log(
          `[skills-content] cache: lost rename race, using existing dir id=${skillId} version=${key}`,
        )
      }
      await touchAccess(finalDir).catch(() => {})
      console.log(
        `[skills-content] cache: unpacked id=${skillId} version=${key} files=${fileCount} extract=${extractMs}ms total=${Date.now() - fetchStart}ms`,
      )
      return finalDir
    } catch (err) {
      console.error(
        `[skills-content] cache: extract failed id=${skillId} version=${key} err=${(err as Error).message}`,
      )
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
      throw err
    }
  })().finally(() => {
    inflight.delete(cacheKey)
  })

  inflight.set(cacheKey, work)
  return work
}

async function dirExists(p: string): Promise<boolean> {
  try {
    const s = await stat(p)
    return s.isDirectory()
  } catch {
    return false
  }
}

async function touchAccess(dir: string) {
  await writeFile(join(dir, '.access'), String(Date.now()))
}

async function extractTarGz(bytes: Buffer, dest: string): Promise<number> {
  const destResolved = resolve(dest)
  const ext = tarExtract()
  let fileCount = 0
  await new Promise<void>((resolveOk, reject) => {
    ext.on('entry', (header, stream, next) => {
      const cleaned = normalize(header.name).replace(/^(\.\.(\/|\\|$))+/, '')
      const target = resolve(dest, cleaned)
      if (target !== destResolved && !target.startsWith(`${destResolved}/`)) {
        stream.resume()
        return next()
      }
      if (header.type === 'directory') {
        mkdir(target, { recursive: true }).then(
          () => {
            stream.resume()
            next()
          },
          (e) => next(e),
        )
        return
      }
      if (header.type === 'file') {
        mkdir(dirname(target), { recursive: true }).then(
          () => {
            pipeline(stream, createWriteStream(target)).then(
              () => {
                fileCount++
                next()
              },
              (e) => next(e),
            )
          },
          (e) => next(e),
        )
        return
      }
      // symlinks, char devices, etc — skip
      stream.resume()
      next()
    })
    ext.on('finish', resolveOk)
    ext.on('error', reject)
    Readable.from(bytes).pipe(createGunzip()).on('error', reject).pipe(ext)
  })
  return fileCount
}
