/**
 * Test helper: build a zip buffer in-memory from a declarative entry list.
 * Mirrors `tar-fixtures.ts` so the same pipeline can be exercised with either
 * archive format without committing binary fixtures.
 */
import { zipSync } from 'fflate'

interface FixtureEntry {
  name: string
  content?: string | Buffer
  type?: 'file' | 'directory'
}

export function buildZip(entries: FixtureEntry[]): Buffer {
  const files: Record<string, Uint8Array> = {}
  for (const e of entries) {
    if ((e.type ?? 'file') === 'directory') {
      // Zip marks directories with a trailing slash and no payload.
      files[e.name.endsWith('/') ? e.name : `${e.name}/`] = new Uint8Array(0)
    } else {
      const body =
        e.content === undefined
          ? Buffer.alloc(0)
          : typeof e.content === 'string'
            ? Buffer.from(e.content, 'utf-8')
            : e.content
      files[e.name] = new Uint8Array(body)
    }
  }
  return Buffer.from(zipSync(files))
}
