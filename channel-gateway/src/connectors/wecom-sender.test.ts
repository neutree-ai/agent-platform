import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Connector, Route } from '../services/db'
import { handleRespondAck, wecomSendStream } from './wecom-sender'

const h = vi.hoisted(() => {
  const ws = { readyState: 1, send: vi.fn() }
  return { ws, current: ws as { readyState: number; send: ReturnType<typeof vi.fn> } | undefined }
})

vi.mock('./wecom', () => ({ getSocket: () => h.current }))
vi.mock('../services/db', () => ({ logEvent: vi.fn(async () => ({})) }))

const connector = { id: 'conn-1', name: 'test-bot' } as Connector
const route = { id: 'route-1', external_id: 'chat-1' } as Route

function sentFrames(): any[] {
  return h.ws.send.mock.calls.map((c) => JSON.parse(c[0] as string))
}

describe('wecomSendStream', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    h.ws.send.mockClear()
    h.current = h.ws
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keepalive re-flushes the current snapshot while the stream is silent', async () => {
    await wecomSendStream(
      connector,
      route,
      { req_id: 'ka-1' },
      {
        content: 'Thinking…',
        finish: false,
      },
    )
    expect(sentFrames()).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(30_000)
    await vi.advanceTimersByTimeAsync(30_000)
    const frames = sentFrames()
    expect(frames).toHaveLength(3)
    // Same stream id, same content, still unfinished.
    expect(frames[2].body.stream.id).toBe(frames[0].body.stream.id)
    expect(frames[2].body.stream).toMatchObject({ content: 'Thinking…', finish: false })

    // Cleanup: finish the stream so no timer leaks into other tests.
    await wecomSendStream(connector, route, { req_id: 'ka-1' }, { content: 'done', finish: true })
  })

  it('keepalive stays quiet when the scheduler is actively flushing', async () => {
    await wecomSendStream(connector, route, { req_id: 'ka-2' }, { content: 'a', finish: false })
    // Scheduler pushes every 25s — always fresher than the keepalive window.
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(25_000)
      await wecomSendStream(
        connector,
        route,
        { req_id: 'ka-2' },
        {
          content: `a${i}`,
          finish: false,
        },
      )
    }
    const streamFrames = sentFrames().filter((f) => f.body.msgtype === 'stream')
    // 1 initial + 4 scheduler flushes, no keepalive extras in between.
    expect(streamFrames).toHaveLength(5)
    await wecomSendStream(connector, route, { req_id: 'ka-2' }, { content: 'done', finish: true })
  })

  it('normal finish sends a finish frame and stops the keepalive', async () => {
    await wecomSendStream(
      connector,
      route,
      { req_id: 'fin-1' },
      {
        content: 'Thinking…',
        finish: false,
      },
    )
    await wecomSendStream(
      connector,
      route,
      { req_id: 'fin-1' },
      {
        content: 'final answer',
        finish: true,
      },
    )
    const frames = sentFrames()
    expect(frames).toHaveLength(2)
    expect(frames[1].body.stream).toMatchObject({ content: 'final answer', finish: true })

    await vi.advanceTimersByTimeAsync(120_000)
    expect(sentFrames()).toHaveLength(2) // keepalive is gone
  })

  it('finish with no open stream falls back to a passive markdown reply', async () => {
    await wecomSendStream(
      connector,
      route,
      { req_id: 'restart-1' },
      {
        content: 'late reply',
        finish: true,
      },
    )
    const frames = sentFrames()
    expect(frames).toHaveLength(1)
    expect(frames[0].body.msgtype).toBe('markdown')
    expect(frames[0].body.markdown.content).toBe('late reply')
    expect(frames[0].headers.req_id).toBe('restart-1')
  })

  it('finish after a rejected frame delivers the reply as markdown too', async () => {
    await wecomSendStream(
      connector,
      route,
      { req_id: 'nack-1' },
      {
        content: 'Thinking…',
        finish: false,
      },
    )
    expect(
      handleRespondAck({ headers: { req_id: 'nack-1' }, errcode: 95001, errmsg: 'stream expired' }),
    ).toBe(true)

    await wecomSendStream(
      connector,
      route,
      { req_id: 'nack-1' },
      {
        content: 'the answer',
        finish: true,
      },
    )
    const frames = sentFrames()
    // placeholder + best-effort stream finish + markdown fallback
    expect(frames).toHaveLength(3)
    expect(frames[1].body.msgtype).toBe('stream')
    expect(frames[1].body.stream.finish).toBe(true)
    expect(frames[2].body.msgtype).toBe('markdown')
    expect(frames[2].body.markdown.content).toBe('the answer')
  })

  it('ok acks do not trigger the fallback', async () => {
    await wecomSendStream(
      connector,
      route,
      { req_id: 'ok-1' },
      {
        content: 'Thinking…',
        finish: false,
      },
    )
    expect(handleRespondAck({ headers: { req_id: 'ok-1' }, errcode: 0 })).toBe(true)
    await wecomSendStream(
      connector,
      route,
      { req_id: 'ok-1' },
      {
        content: 'done',
        finish: true,
      },
    )
    const frames = sentFrames()
    expect(frames).toHaveLength(2)
    expect(frames[1].body.msgtype).toBe('stream')
  })

  it('transport failure mid-job marks the stream broken and falls back on finish', async () => {
    await wecomSendStream(
      connector,
      route,
      { req_id: 'broken-1' },
      {
        content: 'Thinking…',
        finish: false,
      },
    )
    // WS drops; the next keepalive tick fails and marks the stream broken.
    h.current = undefined
    await vi.advanceTimersByTimeAsync(30_000)
    h.current = h.ws

    await wecomSendStream(
      connector,
      route,
      { req_id: 'broken-1' },
      {
        content: 'recovered reply',
        finish: true,
      },
    )
    const frames = sentFrames()
    const last = frames[frames.length - 1]
    expect(last.body.msgtype).toBe('markdown')
    expect(last.body.markdown.content).toBe('recovered reply')
  })

  it('drops stream state past max age; a later finish goes out as markdown', async () => {
    await wecomSendStream(
      connector,
      route,
      { req_id: 'aged-1' },
      {
        content: 'Thinking…',
        finish: false,
      },
    )
    await vi.advanceTimersByTimeAsync(56 * 60_000)
    h.ws.send.mockClear()

    // State is gone — keepalive stopped ticking.
    await vi.advanceTimersByTimeAsync(120_000)
    expect(sentFrames()).toHaveLength(0)

    await wecomSendStream(
      connector,
      route,
      { req_id: 'aged-1' },
      {
        content: 'very late reply',
        finish: true,
      },
    )
    const frames = sentFrames()
    expect(frames).toHaveLength(1)
    expect(frames[0].body.msgtype).toBe('markdown')
  })

  it('handleRespondAck ignores acks for unknown req_ids', () => {
    expect(handleRespondAck({ headers: { req_id: 'nobody' }, errcode: 0 })).toBe(false)
    expect(handleRespondAck({ errcode: 0 })).toBe(false)
  })
})
