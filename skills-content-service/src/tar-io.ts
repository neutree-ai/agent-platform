/**
 * Filesystem-side tar helpers. The pure tar logic (entries in / out of memory)
 * lives in `skill-tar.ts`; this module is the I/O bridge that materializes
 * tar contents to a directory tree, and collects a directory tree back into
 * tar entries for `repack`.
 */
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join, normalize, relative, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import { extract as tarExtract } from 'tar-stream'
import type { TarEntry } from './skill-tar'

/** Extract a tar.gz buffer into `dest`. Returns file count. Skips path-escapes. */
export async function extractTarGzToDir(bytes: Buffer, dest: string): Promise<number> {
  const destResolved = resolve(dest)
  const ext = tarExtract()
  let fileCount = 0
  await new Promise<void>((resolveOk, reject) => {
    ext.on('entry', (header, stream, next) => {
      const cleaned = normalize(header.name).replace(/^(\.\.(\/|\\|$))+/, '')
      const target = resolve(dest, cleaned)
      if (target !== destResolved && !target.startsWith(`${destResolved}${sep}`)) {
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
      stream.resume()
      next()
    })
    ext.on('finish', resolveOk)
    ext.on('error', reject)
    Readable.from(bytes).pipe(createGunzip()).on('error', reject).pipe(ext)
  })
  return fileCount
}

/**
 * Walk `root` and collect every file as a TarEntry suitable for `repack`.
 * Directory entries are emitted only when empty (so `repack` does not embed
 * redundant dir entries for paths already implied by files).
 */
export async function collectDirAsEntries(root: string): Promise<TarEntry[]> {
  const rootResolved = resolve(root)
  const out: TarEntry[] = []
  await walk(rootResolved, rootResolved, out)
  // tar paths use forward slashes regardless of platform.
  for (const e of out) e.header.name = e.header.name.split(sep).join('/')
  return out
}

async function walk(root: string, dir: string, out: TarEntry[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true })
  let hasChild = false
  for (const ent of entries) {
    if (ent.name.startsWith('.tmp-')) continue
    const full = join(dir, ent.name)
    if (ent.isDirectory()) {
      hasChild = true
      await walk(root, full, out)
    } else if (ent.isFile()) {
      hasChild = true
      const rel = relative(root, full)
      const data = await readFile(full)
      const st = await stat(full)
      out.push({
        header: { name: rel, type: 'file', size: data.length, mode: st.mode },
        data,
      })
    }
  }
  // Emit an explicit directory entry when the dir is empty (so it survives a
  // round-trip). Root itself is omitted.
  if (!hasChild && dir !== root) {
    const rel = relative(root, dir)
    out.push({
      header: { name: `${rel}/`, type: 'directory', mode: 0o755 },
      data: Buffer.alloc(0),
    })
  }
}
