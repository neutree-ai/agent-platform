/**
 * Test helper: build a tar.gz buffer in-memory from a declarative entry list.
 * Used to feed the pure tar.ts pipeline with realistic bytes without committing
 * binary fixtures.
 */
import { createGzip } from 'node:zlib'
import { pack } from 'tar-stream'

interface FixtureEntry {
  name: string
  content?: string | Buffer
  type?: 'file' | 'directory'
  mode?: number
}

export function buildTarGz(entries: FixtureEntry[]): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const p = pack()
    const chunks: Buffer[] = []
    const gzip = createGzip()
    gzip.on('data', (c: Buffer) => chunks.push(c))
    gzip.on('end', () => resolve(Buffer.concat(chunks)))
    gzip.on('error', reject)
    p.on('error', reject)
    p.pipe(gzip)
    for (const e of entries) {
      if ((e.type ?? 'file') === 'directory') {
        p.entry({ name: e.name, type: 'directory', mode: e.mode ?? 0o755 })
      } else {
        const body =
          e.content === undefined
            ? Buffer.alloc(0)
            : typeof e.content === 'string'
              ? Buffer.from(e.content, 'utf-8')
              : e.content
        p.entry({ name: e.name, size: body.length, mode: e.mode ?? 0o644 }, body)
      }
    }
    p.finalize()
  })
}
