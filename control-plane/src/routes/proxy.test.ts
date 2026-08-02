/**
 * Agent passthrough deadline.
 *
 * A workspace pod that has exhausted its memory still completes the TCP
 * handshake while its event loop is wedged. Nothing but undici's 300s default
 * ended such a request, and five minutes of a frozen session switch — and
 * with it a dead new-session button — reads as broken.
 *
 * The deadline that fixes it must cover the response headers ONLY: SSE turns
 * flow through this same fetch, and a timer that stayed armed would sever
 * every live stream once it expired. Both halves are pinned here.
 */
import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppEnv } from '../lib/types'

const getWorkspace = vi.hoisted(() => vi.fn())

vi.mock('../services/db/workspaces', () => ({ getWorkspace }))
vi.mock('../lib/workspace-address', () => ({
  resolveAgentAddress: () => 'http://agent-pod:8080',
}))
vi.mock('../lib/sse', () => ({
  createInterceptedSSEResponse: vi.fn(),
  createReconnectSSEResponse: vi.fn(),
}))
vi.mock('../services/db/sessions', () => ({ transitionSessionStatus: vi.fn() }))

const { createProxyRoutes } = await import('./proxy')

const WORKSPACE = { id: 'ws1', user_id: 'u1', status: 'running', is_system: false }

/** Mount the proxy behind a stub auth middleware, as index.ts does. */
function buildApp() {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('user', { sub: 'u1', role: 'user', username: 'u1', name: 'u1', exp: 0 })
    await next()
  })
  app.route('/_proxy', createProxyRoutes())
  return app
}

describe('agent proxy headers deadline', () => {
  beforeEach(() => {
    vi.useRealTimers()
    getWorkspace.mockReset()
    getWorkspace.mockResolvedValue(WORKSPACE)
  })

  it('answers 504 when the pod never produces headers', async () => {
    vi.useFakeTimers()
    // A wedged pod: connection accepted, response never begins. Only an
    // abort ends this promise.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
            )
          }),
      ),
    )

    const pending = buildApp().request('/_proxy/agent/ws1/sessions/s1/pending-question')
    await vi.advanceTimersByTimeAsync(10_000)
    const res = await pending

    expect(res.status).toBe(504)
    expect((await res.json()).error).toMatch(/did not respond/i)
  })

  it('gives non-session paths a budget the session deadline would have cut short', async () => {
    vi.useFakeTimers()
    // `skills/:name/pack` tars a directory over NFS in a throttled pod, and
    // a JSON/tarball handler flushes headers only once it has bytes to send —
    // so the deadline covers the whole job. Holding every path to the session
    // budget would turn a slow pack into a 504.
    let respond!: () => void
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((resolve, reject) => {
            respond = () => resolve(new Response('{}'))
            init.signal?.addEventListener('abort', () =>
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
            )
          }),
      ),
    )

    const pending = buildApp().request('/_proxy/agent/ws1/skills/big-skill/pack', {
      method: 'POST',
    })
    await vi.advanceTimersByTimeAsync(30_000)
    respond()
    const res = await pending

    expect(res.status).toBe(200)
  })

  it('lets an SSE body outlive the deadline once headers have landed', async () => {
    vi.useFakeTimers()
    // Headers arrive immediately; the body stays open far longer than the
    // deadline, which is exactly what a live turn looks like.
    let push!: (chunk: string) => void
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        push = (chunk) => controller.enqueue(new TextEncoder().encode(chunk))
      },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })),
    )

    const res = await buildApp().request('/_proxy/agent/ws1/sessions/s1/stream')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/event-stream')

    // Well past the deadline — had the timer stayed armed, this abort would
    // have destroyed the stream mid-turn.
    await vi.advanceTimersByTimeAsync(60_000)

    push('data: still-alive\n\n')
    const reader = res.body!.getReader()
    const { value } = await reader.read()
    expect(new TextDecoder().decode(value)).toContain('still-alive')
  })
})
