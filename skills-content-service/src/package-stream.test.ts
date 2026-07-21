import { describe, expect, it, vi } from 'vitest'
import { packageStream } from './package-stream'

/** Drain a stream, collecting chunks; rejects if the stream errors. */
async function drain(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const parts: Uint8Array[] = []
  const reader = stream.getReader()
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    parts.push(value)
  }
  return Buffer.concat(parts)
}

/** ChunkReader over an in-memory buffer. */
function readerFor(data: Buffer) {
  return vi.fn(async (offset: number, length: number) => data.subarray(offset, offset + length))
}

describe('packageStream', () => {
  it('streams the exact bytes across multiple chunks', async () => {
    // 10 bytes in chunks of 4 → 4+4+2.
    const data = Buffer.from('0123456789')
    const read = readerFor(data)
    const out = await drain(packageStream(data.byteLength, read, 4))
    expect(out.equals(data)).toBe(true)
    expect(read.mock.calls).toEqual([
      [0, 4],
      [4, 4],
      [8, 2],
    ])
  })

  it('serves a package smaller than one chunk with a single read', async () => {
    const data = Buffer.from('tiny')
    const read = readerFor(data)
    const out = await drain(packageStream(data.byteLength, read, 4 * 1024))
    expect(out.equals(data)).toBe(true)
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('closes immediately for a zero-length package', async () => {
    const read = vi.fn()
    const out = await drain(packageStream(0, read))
    expect(out.byteLength).toBe(0)
    expect(read).not.toHaveBeenCalled()
  })

  it('errors when the row disappears mid-stream', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce(Buffer.alloc(4))
      // Version deleted between chunks.
      .mockResolvedValueOnce(null)
    await expect(drain(packageStream(8, read, 4))).rejects.toThrow(/row disappeared/)
  })

  it('errors on a short read instead of emitting a truncated tarball', async () => {
    const read = vi.fn().mockResolvedValue(Buffer.alloc(2))
    await expect(drain(packageStream(8, read, 4))).rejects.toThrow(/got 2, want 4/)
  })

  it('does not read ahead of consumption (pull-based backpressure)', async () => {
    const data = Buffer.alloc(12)
    const read = readerFor(data)
    const reader = packageStream(data.byteLength, read, 4).getReader()
    await reader.read()
    // One chunk consumed — at most one readahead pull may be in flight, so the
    // reader must not have raced through all three chunks.
    expect(read.mock.calls.length).toBeLessThanOrEqual(2)
    await reader.cancel()
  })
})
