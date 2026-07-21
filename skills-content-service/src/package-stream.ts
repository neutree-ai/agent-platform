/**
 * Chunked streaming of a package bytea to an HTTP response.
 *
 * The naive read (`SELECT package ...`) materializes the whole tarball in
 * this process — and the route then copied it once more — so peak memory
 * scaled as (concurrent downloads × 2 × package size). A burst of a dozen
 * agent boots pulling distinct skills stacked enough tarballs to blow the
 * pod's memory limit (OOM kills observed in production; see issue #159).
 *
 * Instead we probe the byte length server-side (`octet_length`, no bytes
 * transferred) and then read `substring(package FROM off FOR len)` slices,
 * fed through a pull-based ReadableStream so backpressure from a slow
 * client suspends the reads. Peak memory per request is one chunk.
 *
 * Two properties the SQL relies on:
 *  - Chunks address an immutable `skill_versions` row by id (the caller
 *    resolves the active pointer once, up front), so a concurrent
 *    set-active can't tear the bytes mid-stream.
 *  - Tarballs are gzip data, which pglz can't compress, so TOAST stores
 *    them uncompressed and `substring` uses a sliced fetch — O(chunk), not
 *    O(package). Migration 127 sets the column STORAGE EXTERNAL to make
 *    that guarantee explicit rather than heuristic.
 */

/** Reads [offset, offset+length) of the package, 0-based. Null = row gone. */
type ChunkReader = (offset: number, length: number) => Promise<Buffer | null>

/**
 * 4 MiB: almost every skill fits in one chunk (they're KBs to a few MBs),
 * so the common case stays a single read like before — just bounded.
 */
const PACKAGE_CHUNK_BYTES = 4 * 1024 * 1024

/**
 * Stream exactly `byteLength` bytes via `readChunk`.
 *
 * The version row is immutable, so a short or missing read mid-stream means
 * it was deleted under us — the stream errors rather than emitting a
 * silently truncated tarball that the client would hash-reject anyway.
 */
export function packageStream(
  byteLength: number,
  readChunk: ChunkReader,
  chunkBytes = PACKAGE_CHUNK_BYTES,
): ReadableStream<Uint8Array> {
  let offset = 0
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (offset >= byteLength) {
        controller.close()
        return
      }
      const want = Math.min(chunkBytes, byteLength - offset)
      const chunk = await readChunk(offset, want)
      if (!chunk || chunk.byteLength !== want) {
        const detail = chunk ? `got ${chunk.byteLength}, want ${want}` : 'row disappeared'
        controller.error(new Error(`package read failed at ${offset}/${byteLength}: ${detail}`))
        return
      }
      offset += want
      controller.enqueue(chunk)
    },
  })
}
