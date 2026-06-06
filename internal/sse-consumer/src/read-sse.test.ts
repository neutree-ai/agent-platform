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
})
