import { describe, expect, it } from 'vitest'
import { readSSE, type SSEEvent } from './read-sse'

function makeResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c))
      controller.close()
    },
  })
  return new Response(stream)
}

function makeStreamingResponse(): {
  response: Response
  push: (chunk: string) => void
  close: () => void
  error: (err: Error) => void
} {
  const encoder = new TextEncoder()
  let ctrl!: ReadableStreamDefaultController<Uint8Array>
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      ctrl = controller
    },
  })
  return {
    response: new Response(stream),
    push: (chunk) => ctrl.enqueue(encoder.encode(chunk)),
    close: () => ctrl.close(),
    error: (err) => ctrl.error(err),
  }
}

async function collect(gen: AsyncGenerator<SSEEvent>): Promise<SSEEvent[]> {
  const out: SSEEvent[] = []
  for await (const evt of gen) out.push(evt)
  return out
}

describe('readSSE', () => {
  it('parses a single event with default message type', async () => {
    const res = makeResponse(['data: hello\n\n'])
    expect(await collect(readSSE(res))).toEqual([{ event: 'message', data: 'hello' }])
  })

  it('parses explicit event field', async () => {
    const res = makeResponse(['event: session.started\ndata: {"x":1}\n\n'])
    expect(await collect(readSSE(res))).toEqual([
      { event: 'session.started', data: '{"x":1}' },
    ])
  })

  it('concatenates multiple data lines with \\n', async () => {
    const res = makeResponse(['data: line1\ndata: line2\ndata: line3\n\n'])
    expect(await collect(readSSE(res))).toEqual([
      { event: 'message', data: 'line1\nline2\nline3' },
    ])
  })

  it('yields multiple events separated by blank lines', async () => {
    const res = makeResponse(['data: a\n\ndata: b\n\ndata: c\n\n'])
    expect(await collect(readSSE(res))).toEqual([
      { event: 'message', data: 'a' },
      { event: 'message', data: 'b' },
      { event: 'message', data: 'c' },
    ])
  })

  it('resets event type after each event boundary', async () => {
    const res = makeResponse([
      'event: foo\ndata: 1\n\ndata: 2\n\nevent: bar\ndata: 3\n\n',
    ])
    expect(await collect(readSSE(res))).toEqual([
      { event: 'foo', data: '1' },
      { event: 'message', data: '2' },
      { event: 'bar', data: '3' },
    ])
  })

  it('strips a single leading space after the colon', async () => {
    const res = makeResponse(['data:  two-spaces\n\n'])
    expect(await collect(readSSE(res))).toEqual([
      { event: 'message', data: ' two-spaces' },
    ])
  })

  it('handles CRLF line endings', async () => {
    const res = makeResponse(['event: x\r\ndata: y\r\n\r\n'])
    expect(await collect(readSSE(res))).toEqual([{ event: 'x', data: 'y' }])
  })

  it('handles bare CR line endings', async () => {
    const res = makeResponse(['event: x\rdata: y\r\r'])
    expect(await collect(readSSE(res))).toEqual([{ event: 'x', data: 'y' }])
  })

  it('buffers across chunk boundaries mid-line', async () => {
    const res = makeResponse(['data: hel', 'lo wor', 'ld\n\n'])
    expect(await collect(readSSE(res))).toEqual([
      { event: 'message', data: 'hello world' },
    ])
  })

  it('buffers across chunk boundaries mid-event', async () => {
    const res = makeResponse(['event: foo\ndata: ', 'bar\n', '\n'])
    expect(await collect(readSSE(res))).toEqual([{ event: 'foo', data: 'bar' }])
  })

  it('handles chunk split exactly on \\n', async () => {
    const res = makeResponse(['data: a\n', '\ndata: b\n\n'])
    expect(await collect(readSSE(res))).toEqual([
      { event: 'message', data: 'a' },
      { event: 'message', data: 'b' },
    ])
  })

  it('handles multi-byte UTF-8 split across chunks', async () => {
    // U+2265 + U+2264 = E2 89 A5 E2 89 A4. Split the first codepoint mid-sequence.
    const enc = new TextEncoder()
    const full = enc.encode('data: ≥≤\n\n')
    const a = full.slice(0, 7) // "data: " + E2 89
    const b = full.slice(7)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(a)
        controller.enqueue(b)
        controller.close()
      },
    })
    const res = new Response(stream)
    expect(await collect(readSSE(res))).toEqual([
      { event: 'message', data: '≥≤' },
    ])
  })

  it('flushes a trailing event without a final blank line', async () => {
    const res = makeResponse(['data: lonely\n'])
    expect(await collect(readSSE(res))).toEqual([
      { event: 'message', data: 'lonely' },
    ])
  })

  it('ignores unknown fields', async () => {
    const res = makeResponse(['id: 42\nretry: 1000\ndata: ok\n\n'])
    expect(await collect(readSSE(res))).toEqual([
      { event: 'message', data: 'ok' },
    ])
  })

  it('emits nothing for an empty body', async () => {
    const res = makeResponse([''])
    expect(await collect(readSSE(res))).toEqual([])
  })

  it('throws when response has no body', async () => {
    const res = new Response(null)
    await expect(collect(readSSE(res))).rejects.toThrow('no body')
  })

  it('throws AbortError when signal is already aborted', async () => {
    const res = makeResponse(['data: x\n\n'])
    const ctrl = new AbortController()
    ctrl.abort()
    await expect(collect(readSSE(res, { signal: ctrl.signal }))).rejects.toThrow()
  })

  it('throws when the signal aborts mid-stream', async () => {
    const { response, push } = makeStreamingResponse()
    const ctrl = new AbortController()
    const gen = readSSE(response, { signal: ctrl.signal })
    push('data: first\n\n')
    const first = await gen.next()
    expect(first.value).toEqual({ event: 'message', data: 'first' })
    ctrl.abort()
    await expect(gen.next()).rejects.toThrow()
  })

  it('propagates underlying stream errors', async () => {
    const { response, push, error } = makeStreamingResponse()
    const gen = readSSE(response)
    push('data: a\n\n')
    const first = await gen.next()
    expect(first.value).toEqual({ event: 'message', data: 'a' })
    error(new Error('boom'))
    await expect(gen.next()).rejects.toThrow('boom')
  })

  it('supports early break from the consumer', async () => {
    const res = makeResponse(['data: 1\n\ndata: 2\n\ndata: 3\n\n'])
    const got: SSEEvent[] = []
    for await (const evt of readSSE(res)) {
      got.push(evt)
      if (got.length === 2) break
    }
    expect(got).toEqual([
      { event: 'message', data: '1' },
      { event: 'message', data: '2' },
    ])
  })

  it('parses a realistic UniversalEvent stream shape', async () => {
    const body =
      'event: message\n' +
      'data: {"type":"session.started","session_id":"abc"}\n\n' +
      'event: message\n' +
      'data: {"type":"item.completed","item":{"kind":"message"}}\n\n' +
      'event: message\n' +
      'data: {"type":"session.ended","reason":"completed"}\n\n'
    const res = makeResponse([body])
    const events = await collect(readSSE(res))
    expect(events.map((e) => JSON.parse(e.data).type)).toEqual([
      'session.started',
      'item.completed',
      'session.ended',
    ])
  })

  it('treats a CRLF split across chunks as one terminator', async () => {
    const res = makeResponse(['data: a\r', '\ndata: b\r\n\r\n'])
    expect(await collect(readSSE(res))).toEqual([{ event: 'message', data: 'a\nb' }])
  })

  it('treats a CR at chunk end followed by a non-LF as a bare CR terminator', async () => {
    const res = makeResponse(['data: a\r', 'data: b\r', '\r'])
    expect(await collect(readSSE(res))).toEqual([{ event: 'message', data: 'a\nb' }])
  })

  it('keeps a pending CR across an empty chunk', async () => {
    const res = makeResponse(['data: a\r', '', '\n\r\n'])
    expect(await collect(readSSE(res))).toEqual([{ event: 'message', data: 'a' }])
  })

  it('handles CR CR LF as two terminators', async () => {
    const res = makeResponse(['data: a\r', '\r\ndata: b\n\n'])
    expect(await collect(readSSE(res))).toEqual([
      { event: 'message', data: 'a' },
      { event: 'message', data: 'b' },
    ])
  })

  it('ignores comment lines, including a keepalive between events', async () => {
    const res = makeResponse([': hi\n\n', 'data: a\n:\n\n', ':\n\ndata: b\n\n'])
    expect(await collect(readSSE(res))).toEqual([
      { event: 'message', data: 'a' },
      { event: 'message', data: 'b' },
    ])
  })

  it('does not treat a field that merely starts with data/event as that field', async () => {
    const res = makeResponse(['database: x\nevents: y\ndata\ndata: ok\n\n'])
    expect(await collect(readSSE(res))).toEqual([{ event: 'message', data: 'ok' }])
  })

  it('keeps empty data lines', async () => {
    const res = makeResponse(['data:\ndata: \ndata: x\n\n'])
    expect(await collect(readSSE(res))).toEqual([{ event: 'message', data: '\n\nx' }])
  })

  it('handles an unterminated last line that spans chunks', async () => {
    const res = makeResponse(['data: par', 'tial ', 'line'])
    expect(await collect(readSSE(res))).toEqual([{ event: 'message', data: 'partial line' }])
  })

  it('strips one leading BOM, even when it is split across chunks', async () => {
    const bytes = new TextEncoder().encode('\uFEFFdata: a\n\n')
    const res = makeByteResponse([bytes.subarray(0, 1), bytes.subarray(1, 2), bytes.subarray(2)])
    expect(await collect(readSSE(res))).toEqual([{ event: 'message', data: 'a' }])
  })

  it('keeps a second BOM as content, however the stream is chunked', async () => {
    const bytes = new TextEncoder().encode('\uFEFF\uFEFFdata: a\n\n')
    const res = makeByteResponse([bytes.subarray(0, 1), bytes.subarray(1, 2), bytes.subarray(2)])
    expect(await collect(readSSE(res))).toEqual([])
  })

  it('replaces a truncated multi-byte sequence at end of stream', async () => {
    const res = makeByteResponse([
      new TextEncoder().encode('data: ok'),
      new Uint8Array([0xe2, 0x89]),
    ])
    expect(await collect(readSSE(res))).toEqual([{ event: 'message', data: 'ok\uFFFD' }])
  })

  it('reads a 32MB single-line event delivered in 16KB chunks in linear time', async () => {
    const body = 'x'.repeat(32 * 1024 * 1024)
    const bytes = new TextEncoder().encode(`data: ${body}\n\ndata: after\n\n`)
    const chunks: Uint8Array[] = []
    for (let i = 0; i < bytes.length; i += 16384) chunks.push(bytes.subarray(i, i + 16384))
    const t0 = performance.now()
    const events = await collect(readSSE(makeByteResponse(chunks)))
    const ms = performance.now() - t0
    expect(events.length).toBe(2)
    expect(events[0].data === body).toBe(true)
    expect(events[1]).toEqual({ event: 'message', data: 'after' })
    // A reader that rescans the buffered line on every chunk needs tens of
    // seconds here; a linear one needs well under one.
    expect(ms).toBeLessThan(5000)
  }, 30_000)

  it('yields the same events for any chunking', async () => {
    const enc = new TextEncoder()
    const atoms = [
      'data',
      'event',
      'id',
      'retry',
      ':',
      ': ',
      ' ',
      '\n',
      '\n',
      '\n\n',
      '\r',
      '\r\n',
      '\r\n\r\n',
      'a',
      'bc',
      '{"k":1}',
      '≥',
      '你好',
      '😀',
      '\uFEFF',
      'data: ',
      'event: x',
      'data:',
    ]
    const rand = seededRandom(20261013)
    let crAtChunkEnd = 0
    for (let iter = 0; iter < 5000; iter++) {
      let text = ''
      const n = 1 + Math.floor(rand() * 40)
      for (let i = 0; i < n; i++) text += atoms[Math.floor(rand() * atoms.length)]
      const bytes = enc.encode(text)
      const expected = parseWhole(text)
      expect(await collect(readSSE(makeByteResponse([bytes]))), JSON.stringify(text)).toEqual(
        expected,
      )

      for (let k = 0; k < 3; k++) {
        const chunks: Uint8Array[] = []
        for (let i = 0; i < bytes.length; ) {
          const roll = rand()
          const size = roll < 0.15 ? 0 : roll < 0.6 ? 1 : 1 + Math.floor(rand() * 8)
          chunks.push(bytes.subarray(i, i + size))
          i += size
        }
        for (let c = 0; c + 1 < chunks.length; c++) {
          if (chunks[c].length > 0 && chunks[c][chunks[c].length - 1] === 13) crAtChunkEnd++
        }
        expect(
          await collect(readSSE(makeByteResponse(chunks))),
          `${JSON.stringify(text)} split as ${JSON.stringify(chunks.map((c) => c.length))}`,
        ).toEqual(expected)
      }
    }
    // The generator has to actually exercise terminators cut at a chunk edge.
    expect(crAtChunkEnd).toBeGreaterThan(500)
  }, 60_000)
})

function makeByteResponse(chunks: Uint8Array[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c)
      controller.close()
    },
  })
  return new Response(stream)
}

// Deterministic PRNG (mulberry32) so a failing input can be reproduced.
function seededRandom(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Reference parser over the complete text of a stream: the obvious
// whole-string formulation of the same rules, with no chunk state.
function parseWhole(text: string): SSEEvent[] {
  const events: SSEEvent[] = []
  let event = 'message'
  let data: string[] = []
  const flush = () => {
    if (data.length > 0 || event !== 'message') events.push({ event, data: data.join('\n') })
    event = 'message'
    data = []
  }
  const body = text.startsWith('\uFEFF') ? text.slice(1) : text
  for (const line of body.split(/\r\n|\r|\n/)) {
    if (line === '') {
      flush()
      continue
    }
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const field = line.slice(0, colon)
    let value = line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'data') data.push(value)
    else if (field === 'event') event = value || 'message'
  }
  flush()
  return events
}
