import { describe, expect, it, vi } from 'vitest'
import type { UniversalEvent, TurnStats } from '../../types/events'
import { runTurn, type TurnPlugin, type TurnResult } from './run-turn'

// ── Test helpers ──

function sseFrame(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`
}

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
  }
}

function evt(body: Partial<UniversalEvent> & { type: string }): UniversalEvent {
  return { timestamp: Date.now(), ...body } as UniversalEvent
}

// Capture plugin that records everything for assertions.
function recordingPlugin(name: string): {
  plugin: TurnPlugin
  events: Array<{ event: UniversalEvent; rawData: string }>
  lifecycle: string[]
  endResult: TurnResult | null
} {
  const events: Array<{ event: UniversalEvent; rawData: string }> = []
  const lifecycle: string[] = []
  let endResult: TurnResult | null = null
  return {
    events,
    lifecycle,
    get endResult() {
      return endResult
    },
    set endResult(v: TurnResult | null) {
      endResult = v
    },
    plugin: {
      name,
      onStart: async () => {
        lifecycle.push('start')
      },
      onEvent: (e, raw) => {
        events.push({ event: e, rawData: raw })
      },
      onError: async () => {
        lifecycle.push('error')
      },
      onEnd: async (r) => {
        lifecycle.push('end')
        endResult = r
      },
    },
  }
}

const STATS: TurnStats = {
  costUsd: 0.01,
  durationMs: 1234,
  numTurns: 1,
  inputTokens: 100,
  outputTokens: 200,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  contextTokens: 500,
  contextWindow: 200000,
}

// ── Tests ──

describe('runTurn — happy path', () => {
  it('completes a simple turn and returns sessionId + stats', async () => {
    const rec = recordingPlugin('rec')
    const response = makeResponse([
      sseFrame(evt({ type: 'session.started', session_id: 'sess-1' })),
      sseFrame(evt({ type: 'item.started' })),
      sseFrame(evt({ type: 'item.completed' })),
      sseFrame(evt({ type: 'session.ended', reason: 'completed', stats: STATS })),
    ])
    const result = await runTurn(
      { stream: async () => response, idleTimeoutMs: 0 },
      [rec.plugin],
    )
    expect(result.reason).toBe('completed')
    expect(result.sessionId).toBe('sess-1')
    expect(result.stats).toEqual(STATS)
    expect(result.error).toBeUndefined()
    expect(rec.events.map((e) => e.event.type)).toEqual([
      'session.started',
      'item.started',
      'item.completed',
      'session.ended',
    ])
    expect(rec.lifecycle).toEqual(['start', 'end'])
    expect(rec.endResult?.reason).toBe('completed')
  })

  it('passes raw JSON string to plugins', async () => {
    const rec = recordingPlugin('rec')
    const raw = '{"type":"session.started","session_id":"abc","timestamp":1}'
    const response = makeResponse([
      `data: ${raw}\n\n`,
      sseFrame(evt({ type: 'session.ended', reason: 'completed' })),
    ])
    await runTurn({ stream: async () => response, idleTimeoutMs: 0 }, [rec.plugin])
    expect(rec.events[0].rawData).toBe(raw)
  })

  it('distributes events to all plugins in registration order', async () => {
    const a = recordingPlugin('a')
    const b = recordingPlugin('b')
    const order: string[] = []
    const tracker: TurnPlugin = {
      name: 'tracker',
      onEvent: (e) => order.push(`t:${e.type}`),
    }
    const aWrapped: TurnPlugin = {
      ...a.plugin,
      onEvent: (e, r) => {
        order.push(`a:${e.type}`)
        a.plugin.onEvent?.(e, r)
      },
    }
    const bWrapped: TurnPlugin = {
      ...b.plugin,
      onEvent: (e, r) => {
        order.push(`b:${e.type}`)
        b.plugin.onEvent?.(e, r)
      },
    }
    const response = makeResponse([
      sseFrame(evt({ type: 'session.started', session_id: 's' })),
      sseFrame(evt({ type: 'session.ended', reason: 'completed' })),
    ])
    await runTurn({ stream: async () => response, idleTimeoutMs: 0 }, [
      aWrapped,
      tracker,
      bWrapped,
    ])
    expect(order).toEqual([
      'a:session.started',
      't:session.started',
      'b:session.started',
      'a:session.ended',
      't:session.ended',
      'b:session.ended',
    ])
  })

  it('ignores a later session.started with a different id', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const rec = recordingPlugin('rec')
    const response = makeResponse([
      sseFrame(evt({ type: 'session.started', session_id: 'first' })),
      sseFrame(evt({ type: 'session.started', session_id: 'second' })),
      sseFrame(evt({ type: 'session.ended', reason: 'completed' })),
    ])
    const result = await runTurn(
      { stream: async () => response, idleTimeoutMs: 0 },
      [rec.plugin],
    )
    expect(result.sessionId).toBe('first')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('runTurn — session.ended reasons', () => {
  it('maps session.ended reason=interrupted to TurnResult.reason=interrupted', async () => {
    const response = makeResponse([
      sseFrame(evt({ type: 'session.started', session_id: 's' })),
      sseFrame(evt({ type: 'session.ended', reason: 'interrupted' })),
    ])
    const result = await runTurn(
      { stream: async () => response, idleTimeoutMs: 0 },
      [],
    )
    expect(result.reason).toBe('interrupted')
    expect(result.error?.reason).toBe('interrupted')
  })

  it('maps session.ended reason=error to TurnResult.reason=error', async () => {
    const response = makeResponse([
      sseFrame(evt({ type: 'session.started', session_id: 's' })),
      sseFrame(evt({ type: 'session.ended', reason: 'error' })),
    ])
    const result = await runTurn(
      { stream: async () => response, idleTimeoutMs: 0 },
      [],
    )
    expect(result.reason).toBe('error')
    expect(result.error?.message).toContain('error')
  })
})

describe('runTurn — abnormal stream ends', () => {
  it('returns reason=error when stream closes without session.ended', async () => {
    const response = makeResponse([
      sseFrame(evt({ type: 'session.started', session_id: 's' })),
      sseFrame(evt({ type: 'item.started' })),
      // no session.ended
    ])
    const result = await runTurn(
      { stream: async () => response, idleTimeoutMs: 0 },
      [],
    )
    expect(result.reason).toBe('error')
    expect(result.sessionId).toBe('s')
    expect(result.error?.message).toMatch(/without session\.ended/)
  })

  it('returns reason=error and does not throw when source.stream() rejects', async () => {
    const err = new Error('fetch failed')
    const result = await runTurn(
      {
        stream: async () => {
          throw err
        },
        idleTimeoutMs: 0,
      },
      [],
    )
    expect(result.reason).toBe('error')
    expect(result.error?.message).toBe('fetch failed')
    expect(result.error?.cause).toBe(err)
  })

  it('returns reason=error when Response has no body', async () => {
    const result = await runTurn(
      {
        stream: async () => new Response(null),
        idleTimeoutMs: 0,
      },
      [],
    )
    expect(result.reason).toBe('error')
    expect(result.error?.message).toMatch(/no body/)
  })

  it('returns reason=error when upstream stream errors mid-flight', async () => {
    const encoder = new TextEncoder()
    let ctrl!: ReadableStreamDefaultController<Uint8Array>
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        ctrl = c
        c.enqueue(encoder.encode(sseFrame(evt({ type: 'session.started', session_id: 's' }))))
        setTimeout(() => c.error(new Error('upstream boom')), 5)
      },
    })
    const result = await runTurn(
      { stream: async () => new Response(stream), idleTimeoutMs: 0 },
      [],
    )
    expect(result.reason).toBe('error')
    expect(result.error?.message).toContain('boom')
  })
})

describe('runTurn — abort and timeout', () => {
  it('returns reason=aborted when external signal is already aborted', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    const response = makeResponse([
      sseFrame(evt({ type: 'session.started', session_id: 's' })),
      sseFrame(evt({ type: 'session.ended', reason: 'completed' })),
    ])
    const result = await runTurn(
      { stream: async () => response, signal: ctrl.signal, idleTimeoutMs: 0 },
      [],
    )
    expect(result.reason).toBe('aborted')
  })

  it('returns reason=aborted when external signal fires mid-stream', async () => {
    const { response, push } = makeStreamingResponse()
    const ctrl = new AbortController()
    push(sseFrame(evt({ type: 'session.started', session_id: 's' })))
    const p = runTurn(
      { stream: async () => response, signal: ctrl.signal, idleTimeoutMs: 0 },
      [],
    )
    // Give runTurn a tick to start consuming.
    await new Promise((r) => setTimeout(r, 10))
    ctrl.abort()
    const result = await p
    expect(result.reason).toBe('aborted')
    expect(result.sessionId).toBe('s')
  })

  it('returns reason=timeout when idle timeout fires', async () => {
    const { response, push } = makeStreamingResponse()
    push(sseFrame(evt({ type: 'session.started', session_id: 's' })))
    const result = await runTurn(
      { stream: async () => response, idleTimeoutMs: 30 },
      [],
    )
    expect(result.reason).toBe('timeout')
    expect(result.error?.message).toMatch(/idle timeout/)
  })

  it('does not timeout when events keep arriving', async () => {
    const { response, push, close } = makeStreamingResponse()
    push(sseFrame(evt({ type: 'session.started', session_id: 's' })))
    const p = runTurn(
      { stream: async () => response, idleTimeoutMs: 50 },
      [],
    )
    // Keep pushing events faster than the timeout.
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 20))
      push(sseFrame(evt({ type: 'item.started' })))
    }
    push(sseFrame(evt({ type: 'session.ended', reason: 'completed' })))
    close()
    const result = await p
    expect(result.reason).toBe('completed')
  })
})

describe('runTurn — plugin error isolation', () => {
  it('logs and continues when a plugin onEvent throws', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const good = recordingPlugin('good')
    const bad: TurnPlugin = {
      name: 'bad',
      onEvent: () => {
        throw new Error('plugin boom')
      },
    }
    const response = makeResponse([
      sseFrame(evt({ type: 'session.started', session_id: 's' })),
      sseFrame(evt({ type: 'item.started' })),
      sseFrame(evt({ type: 'session.ended', reason: 'completed' })),
    ])
    const result = await runTurn(
      { stream: async () => response, idleTimeoutMs: 0 },
      [bad, good.plugin],
    )
    expect(result.reason).toBe('completed')
    expect(good.events).toHaveLength(3)
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })

  it('aborts the turn when plugin onStart throws but still calls onEnd', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onEnd = vi.fn()
    const good: TurnPlugin = { name: 'good', onEnd }
    const bad: TurnPlugin = {
      name: 'bad',
      onStart: async () => {
        throw new Error('start boom')
      },
      onEnd,
    }
    let streamCalled = false
    const result = await runTurn(
      {
        stream: async () => {
          streamCalled = true
          return makeResponse([])
        },
        idleTimeoutMs: 0,
      },
      [bad, good],
    )
    expect(result.reason).toBe('error')
    expect(result.error?.message).toMatch(/onStart threw/)
    expect(streamCalled).toBe(false)
    expect(onEnd).toHaveBeenCalledTimes(2) // both plugins' onEnd fire
    err.mockRestore()
  })

  it('downgrades completed to error if a plugin onEnd throws', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const bad: TurnPlugin = {
      name: 'bad',
      onEnd: async () => {
        throw new Error('end boom')
      },
    }
    const response = makeResponse([
      sseFrame(evt({ type: 'session.started', session_id: 's' })),
      sseFrame(evt({ type: 'session.ended', reason: 'completed' })),
    ])
    const result = await runTurn(
      { stream: async () => response, idleTimeoutMs: 0 },
      [bad],
    )
    expect(result.reason).toBe('error')
    expect(result.error?.message).toMatch(/onEnd threw/)
    err.mockRestore()
  })

  it('calls onError only on error paths, before onEnd', async () => {
    const order: string[] = []
    const p: TurnPlugin = {
      name: 'p',
      onError: async () => {
        order.push('error')
      },
      onEnd: async () => {
        order.push('end')
      },
    }
    // Error path: no session.ended
    const r1 = await runTurn(
      {
        stream: async () => makeResponse([sseFrame(evt({ type: 'item.started' }))]),
        idleTimeoutMs: 0,
      },
      [p],
    )
    expect(r1.reason).toBe('error')
    expect(order).toEqual(['error', 'end'])

    // Completed path: no onError
    order.length = 0
    const r2 = await runTurn(
      {
        stream: async () =>
          makeResponse([
            sseFrame(evt({ type: 'session.started', session_id: 's' })),
            sseFrame(evt({ type: 'session.ended', reason: 'completed' })),
          ]),
        idleTimeoutMs: 0,
      },
      [p],
    )
    expect(r2.reason).toBe('completed')
    expect(order).toEqual(['end'])
  })
})

describe('runTurn — JSON parse failures', () => {
  it('synthesizes an error event when JSON parse fails', async () => {
    const rec = recordingPlugin('rec')
    const response = makeResponse([
      'data: {not valid json}\n\n',
      sseFrame(evt({ type: 'session.started', session_id: 's' })),
      sseFrame(evt({ type: 'session.ended', reason: 'completed' })),
    ])
    const result = await runTurn(
      { stream: async () => response, idleTimeoutMs: 0 },
      [rec.plugin],
    )
    expect(result.reason).toBe('completed')
    // 3 events delivered: synthesized error, session.started, session.ended
    expect(rec.events.map((e) => e.event.type)).toEqual([
      'error',
      'session.started',
      'session.ended',
    ])
    const errEvt = rec.events[0].event
    expect(errEvt.code).toBe('parse_error')
    expect(errEvt.message).toMatch(/failed to parse/)
  })

  it('synthesizes an error event for valid JSON with invalid shape', async () => {
    const rec = recordingPlugin('rec')
    const response = makeResponse([
      'data: 42\n\n',
      'data: {"noType":"x"}\n\n',
      sseFrame(evt({ type: 'session.ended', reason: 'completed' })),
    ])
    await runTurn(
      { stream: async () => response, idleTimeoutMs: 0 },
      [rec.plugin],
    )
    const synthesized = rec.events.filter(
      (e) => e.event.type === 'error' && e.event.code === 'parse_error',
    )
    expect(synthesized).toHaveLength(2)
  })
})

describe('runTurn — reconnect', () => {
  it('uses reconnect to recover a turn when primary closes without session.ended', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const rec = recordingPlugin('rec')
    const primary = makeResponse([
      sseFrame(evt({ type: 'session.started', session_id: 'sess-1' })),
      sseFrame(evt({ type: 'item.started' })),
      // no session.ended
    ])
    const reconnectResp = makeResponse([
      sseFrame(evt({ type: 'item.completed' })),
      sseFrame(evt({ type: 'session.ended', reason: 'completed', stats: STATS })),
    ])
    const result = await runTurn(
      {
        stream: async () => primary,
        reconnect: async () => reconnectResp,
        idleTimeoutMs: 0,
      },
      [rec.plugin],
    )
    expect(result.reason).toBe('completed')
    expect(result.sessionId).toBe('sess-1')
    expect(result.stats).toEqual(STATS)
    expect(rec.events.map((e) => e.event.type)).toEqual([
      'session.started',
      'item.started',
      'item.completed',
      'session.ended',
    ])
    log.mockRestore()
  })

  it('triggers reconnect when source.stream() rejects', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const rec = recordingPlugin('rec')
    const reconnectResp = makeResponse([
      sseFrame(evt({ type: 'session.started', session_id: 'sess-1' })),
      sseFrame(evt({ type: 'session.ended', reason: 'completed' })),
    ])
    const result = await runTurn(
      {
        stream: async () => {
          throw new Error('primary fetch failed')
        },
        reconnect: async () => reconnectResp,
        idleTimeoutMs: 0,
      },
      [rec.plugin],
    )
    expect(result.reason).toBe('completed')
    expect(rec.events.map((e) => e.event.type)).toEqual([
      'session.started',
      'session.ended',
    ])
    log.mockRestore()
  })

  it('triggers reconnect when primary stream errors mid-flight', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const encoder = new TextEncoder()
    const primary = new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(encoder.encode(sseFrame(evt({ type: 'session.started', session_id: 's' }))))
          setTimeout(() => c.error(new Error('primary dead')), 5)
        },
      }),
    )
    const reconnectResp = makeResponse([
      sseFrame(evt({ type: 'session.ended', reason: 'completed' })),
    ])
    const result = await runTurn(
      {
        stream: async () => primary,
        reconnect: async () => reconnectResp,
        idleTimeoutMs: 0,
      },
      [],
    )
    expect(result.reason).toBe('completed')
    log.mockRestore()
  })

  it('does not reconnect when primary reached session.ended', async () => {
    const reconnectFn = vi.fn(async () => makeResponse([]))
    const result = await runTurn(
      {
        stream: async () =>
          makeResponse([
            sseFrame(evt({ type: 'session.started', session_id: 's' })),
            sseFrame(evt({ type: 'session.ended', reason: 'completed' })),
          ]),
        reconnect: reconnectFn,
        idleTimeoutMs: 0,
      },
      [],
    )
    expect(result.reason).toBe('completed')
    expect(reconnectFn).not.toHaveBeenCalled()
  })

  it('does not reconnect on external abort', async () => {
    const reconnectFn = vi.fn(async () => makeResponse([]))
    const ctrl = new AbortController()
    ctrl.abort()
    await runTurn(
      {
        stream: async () =>
          makeResponse([sseFrame(evt({ type: 'session.started', session_id: 's' }))]),
        reconnect: reconnectFn,
        signal: ctrl.signal,
        idleTimeoutMs: 0,
      },
      [],
    )
    expect(reconnectFn).not.toHaveBeenCalled()
  })

  it('does not reconnect on idle timeout', async () => {
    const reconnectFn = vi.fn(async () => makeResponse([]))
    const { response, push } = makeStreamingResponse()
    push(sseFrame(evt({ type: 'session.started', session_id: 's' })))
    const result = await runTurn(
      {
        stream: async () => response,
        reconnect: reconnectFn,
        idleTimeoutMs: 30,
      },
      [],
    )
    expect(result.reason).toBe('timeout')
    expect(reconnectFn).not.toHaveBeenCalled()
  })

  it('does not reconnect when onStart failed', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const reconnectFn = vi.fn(async () => makeResponse([]))
    const streamFn = vi.fn(async () => makeResponse([]))
    const result = await runTurn(
      {
        stream: streamFn,
        reconnect: reconnectFn,
        idleTimeoutMs: 0,
      },
      [
        {
          name: 'bad',
          onStart: async () => {
            throw new Error('start boom')
          },
        },
      ],
    )
    expect(result.reason).toBe('error')
    expect(streamFn).not.toHaveBeenCalled()
    expect(reconnectFn).not.toHaveBeenCalled()
    err.mockRestore()
  })

  it('attempts reconnect at most once', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const reconnectFn = vi.fn(async () =>
      // Reconnect also closes without session.ended — must NOT retry.
      makeResponse([sseFrame(evt({ type: 'item.started' }))]),
    )
    const result = await runTurn(
      {
        stream: async () =>
          makeResponse([sseFrame(evt({ type: 'session.started', session_id: 's' }))]),
        reconnect: reconnectFn,
        idleTimeoutMs: 0,
      },
      [],
    )
    expect(result.reason).toBe('error')
    expect(reconnectFn).toHaveBeenCalledTimes(1)
    log.mockRestore()
  })

  it('reports error when reconnect source returns null', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const result = await runTurn(
      {
        stream: async () =>
          makeResponse([sseFrame(evt({ type: 'session.started', session_id: 's' }))]),
        reconnect: async () => null,
        idleTimeoutMs: 0,
      },
      [],
    )
    expect(result.reason).toBe('error')
    expect(result.error?.message).toMatch(/without session\.ended/)
    log.mockRestore()
  })

  it('reports error when reconnect source itself throws', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const result = await runTurn(
      {
        stream: async () =>
          makeResponse([sseFrame(evt({ type: 'session.started', session_id: 's' }))]),
        reconnect: async () => {
          throw new Error('reconnect fetch failed')
        },
        idleTimeoutMs: 0,
      },
      [],
    )
    expect(result.reason).toBe('error')
    expect(result.error?.message).toMatch(/reconnect source threw/)
    err.mockRestore()
    log.mockRestore()
  })

  it('dispatches reconnect events continuously to the same plugin', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const rec = recordingPlugin('rec')
    const primary = makeResponse([
      sseFrame(evt({ type: 'session.started', session_id: 's' })),
      sseFrame(evt({ type: 'item.started' })),
    ])
    const reconnectResp = makeResponse([
      sseFrame(evt({ type: 'item.completed' })),
      sseFrame(evt({ type: 'session.ended', reason: 'completed' })),
    ])
    await runTurn(
      {
        stream: async () => primary,
        reconnect: async () => reconnectResp,
        idleTimeoutMs: 0,
      },
      [rec.plugin],
    )
    // Plugin sees events from both streams without knowing which was which.
    expect(rec.events).toHaveLength(4)
    expect(rec.lifecycle).toEqual(['start', 'end'])
    log.mockRestore()
  })

  it('ignores a duplicate session.started from the reconnect stream', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const primary = makeResponse([
      sseFrame(evt({ type: 'session.started', session_id: 'sess-1' })),
    ])
    const reconnectResp = makeResponse([
      sseFrame(evt({ type: 'session.started', session_id: 'sess-1' })),
      sseFrame(evt({ type: 'session.ended', reason: 'completed' })),
    ])
    const result = await runTurn(
      {
        stream: async () => primary,
        reconnect: async () => reconnectResp,
        idleTimeoutMs: 0,
      },
      [],
    )
    expect(result.reason).toBe('completed')
    expect(result.sessionId).toBe('sess-1')
    log.mockRestore()
    warn.mockRestore()
  })
})

describe('runTurn — onStart / onEnd guarantees', () => {
  it('calls onStart and onEnd exactly once in the happy path', async () => {
    const onStart = vi.fn()
    const onEnd = vi.fn()
    const response = makeResponse([
      sseFrame(evt({ type: 'session.started', session_id: 's' })),
      sseFrame(evt({ type: 'session.ended', reason: 'completed' })),
    ])
    await runTurn(
      { stream: async () => response, idleTimeoutMs: 0 },
      [{ name: 'p', onStart, onEnd }],
    )
    expect(onStart).toHaveBeenCalledTimes(1)
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('still calls onEnd when source.stream() throws', async () => {
    const onEnd = vi.fn()
    await runTurn(
      {
        stream: async () => {
          throw new Error('boom')
        },
        idleTimeoutMs: 0,
      },
      [{ name: 'p', onEnd }],
    )
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(onEnd.mock.calls[0][0].reason).toBe('error')
  })

  it('passes the same result object to onEnd as runTurn returns', async () => {
    let received: TurnResult | null = null
    const p: TurnPlugin = {
      name: 'p',
      onEnd: (r) => {
        received = r
      },
    }
    const response = makeResponse([
      sseFrame(evt({ type: 'session.started', session_id: 's' })),
      sseFrame(evt({ type: 'session.ended', reason: 'completed', stats: STATS })),
    ])
    const result = await runTurn(
      { stream: async () => response, idleTimeoutMs: 0 },
      [p],
    )
    expect(received).not.toBeNull()
    expect(received?.sessionId).toBe(result.sessionId)
    expect(received?.reason).toBe(result.reason)
    expect(received?.stats).toEqual(result.stats)
  })
})
