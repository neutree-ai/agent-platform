import { afterEach, describe, expect, it, vi } from 'vitest'
import { activeStreams, createInterceptedSSEResponse, setupActiveStream } from './sse'

afterEach(() => {
  for (const stream of activeStreams.values()) {
    if (stream.heartbeatTimer) clearInterval(stream.heartbeatTimer)
  }
  activeStreams.clear()
})

// A turn that takes a session over leaves the earlier turn's stream open: that
// stream ends when the agent closes it, which can be much later or never.
// Whatever the earlier turn holds for the session has to be given up at the
// takeover, not at the end of its stream.
describe('setupActiveStream replacement', () => {
  it('tells the stream it replaces', () => {
    const first = setupActiveStream('ws1', 's1').activeStream
    first.onReplaced = vi.fn()

    const second = setupActiveStream('ws1', 's1').activeStream

    expect(first.onReplaced).toHaveBeenCalledTimes(1)
    expect(first.done).toBe(true)
    expect(activeStreams.get('ws1:s1')).toBe(second)
  })

  it('leaves streams of other sessions alone', () => {
    const other = setupActiveStream('ws1', 's2').activeStream
    other.onReplaced = vi.fn()

    setupActiveStream('ws1', 's1')

    expect(other.onReplaced).not.toHaveBeenCalled()
    expect(other.done).toBe(false)
  })

  it('settles the session of an intercepted turn that is replaced', async () => {
    const onSessionSettled = vi.fn()
    // An agent stream that stays open and silent, like a turn whose agent
    // side has moved on to the turn that replaced it.
    const silent = new Response(new ReadableStream<Uint8Array>({ start() {} }), {
      headers: { 'Content-Type': 'text/event-stream' },
    })
    createInterceptedSSEResponse(silent, {
      workspaceId: 'ws1',
      userMessageText: null,
      existingSessionId: 's1',
      onSessionSettled,
    })
    expect(onSessionSettled).not.toHaveBeenCalled()

    setupActiveStream('ws1', 's1')

    expect(onSessionSettled).toHaveBeenCalledTimes(1)
  })
})
