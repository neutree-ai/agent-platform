import type { Duplex } from 'node:stream'

// A tiny request/response RPC over a single mux substream, used for control
// operations that need a reply (unlike forward/reverse streams, which are raw
// byte pipes). One stream carries exactly one request frame and one response
// frame, then closes. Framing is a 4-byte big-endian length prefix + a JSON
// body — small messages only (afs control ops), never bulk data.
//
// cp opens the stream and calls `callControl`; the runner receives it and
// `serveControl` runs a handler and writes the reply. The mux never parses these
// bytes — it just carries the substream.

const MAX_FRAME = 1 << 20 // 1 MiB — control messages are tiny; cap guards against a runaway/hostile peer.

/** Read exactly one length-prefixed JSON frame from a stream. */
function readFrame(stream: Duplex, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let need = -1 // -1 until the 4-byte length header is in hand
    let total = 0

    const timer = setTimeout(() => fail(new Error('control frame timeout')), timeoutMs)
    function cleanup() {
      clearTimeout(timer)
      stream.off('data', onData)
      stream.off('error', fail)
      stream.off('close', onClose)
    }
    function fail(err: Error) {
      cleanup()
      reject(err)
    }
    function onClose() {
      fail(new Error('control stream closed before a full frame'))
    }
    function onData(chunk: Buffer) {
      chunks.push(chunk)
      total += chunk.length
      const buf = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks)
      if (chunks.length > 1) {
        chunks.length = 0
        chunks.push(buf)
      }
      if (need < 0) {
        if (buf.length < 4) return
        need = buf.readUInt32BE(0)
        if (need > MAX_FRAME) return fail(new Error(`control frame too large: ${need}`))
      }
      if (need >= 0 && total >= need + 4) {
        cleanup()
        try {
          resolve(JSON.parse(buf.subarray(4, 4 + need).toString('utf8')))
        } catch (e) {
          reject(e as Error)
        }
      }
    }
    stream.on('data', onData)
    stream.on('error', fail)
    stream.on('close', onClose)
  })
}

function writeFrame(stream: Duplex, value: unknown): void {
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  const header = Buffer.allocUnsafe(4)
  header.writeUInt32BE(body.length, 0)
  stream.write(Buffer.concat([header, body]))
}

/**
 * Send one request over `stream` and await the single response frame. Resolves
 * with the parsed response, rejects on timeout / stream error / malformed frame.
 * Always destroys the stream when done.
 */
export async function callControl<Res = unknown>(
  stream: Duplex,
  req: unknown,
  timeoutMs = 15_000,
): Promise<Res> {
  try {
    writeFrame(stream, req)
    const res = (await readFrame(stream, timeoutMs)) as Res
    return res
  } finally {
    stream.destroy()
  }
}

/**
 * Receive one request on `stream`, run `handler`, and write its result back as
 * the response frame. A thrown handler is reported as `{ error }`. Closes the
 * stream after replying.
 */
export async function serveControl(
  stream: Duplex,
  handler: (req: unknown) => Promise<unknown>,
  timeoutMs = 15_000,
): Promise<void> {
  try {
    const req = await readFrame(stream, timeoutMs)
    let res: unknown
    try {
      res = await handler(req)
    } catch (e) {
      res = { error: (e as Error).message }
    }
    writeFrame(stream, res)
    stream.end()
  } catch {
    stream.destroy()
  }
}
