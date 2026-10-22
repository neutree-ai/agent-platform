import { describe, expect, it, vi } from 'vitest'
import { NapClient } from './client.js'
import { createSessionRelay } from './session-relay.js'

type Ctx = { person: string }

// A platform that records what it was asked and answers per path.
function platform(
  answer: (path: string, init: RequestInit) => Response | undefined = () => undefined,
) {
  const calls: { path: string; method: string; body?: string; auth: string | null }[] = []
  const fetchMock = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    const path = String(url).replace('https://nap.test', '')
    calls.push({
      path,
      method: init.method ?? 'GET',
      body: typeof init.body === 'string' ? init.body : undefined,
      auth: new Headers(init.headers).get('Authorization'),
    })
    return (
      answer(path, init) ?? new Response('{}', { headers: { 'Content-Type': 'application/json' } })
    )
  })
  const client = new NapClient({
    baseUrl: 'https://nap.test',
    token: 'alice-token',
    fetch: fetchMock as typeof fetch,
  })
  return { client, calls }
}

function relayFor(
  client: NapClient,
  extra: Partial<Parameters<typeof createSessionRelay<Ctx>>[0]> = {},
) {
  return createSessionRelay<Ctx>({
    basePath: '/api/nap',
    // Alice's page may name only her own key; it maps to her workspace.
    resolve: async (ctx, workspace) =>
      ctx.person === 'alice' && workspace === 'mine'
        ? { client, workspaceId: 'alice-ws' }
        : new Response('{"error":"forbidden"}', { status: 403 }),
    ...extra,
  })
}

const call = (path: string, init: RequestInit = {}) =>
  new Request(`https://app.test/api/nap${path}`, init)

describe('session relay', () => {
  it("relays to the person's own workspace, with their token", async () => {
    const { client, calls } = platform()
    const relay = relayFor(client)

    const res = await relay.handle(call('/workspaces/mine/sessions/s1'), { person: 'alice' })

    expect(res.status).toBe(200)
    expect(calls).toEqual([
      {
        path: '/api/workspaces/alice-ws/sessions/s1',
        method: 'GET',
        body: undefined,
        auth: 'Bearer alice-token',
      },
    ])
  })

  it('passes on what resolve refuses with, calling nothing', async () => {
    const { client, calls } = platform()
    const relay = relayFor(client)

    const res = await relay.handle(call('/workspaces/someone-else/sessions/s1'), {
      person: 'alice',
    })

    expect(res.status).toBe(403)
    expect(calls).toHaveLength(0)
  })

  it('points stored images at the relay', async () => {
    const { client } = platform(() =>
      Response.json([
        { blocks: [{ type: 'image', url: '/api/workspaces/alice-ws/messages/m1/blocks/2/image' }] },
      ]),
    )
    const relay = relayFor(client)

    const res = await relay.handle(call('/workspaces/mine/messages?session_id=s1'), {
      person: 'alice',
    })

    const [message] = await res.json()
    expect(message.blocks[0].url).toBe('/api/nap/workspaces/mine/messages/m1/blocks/2/image')
  })

  it('serves a stored image only as an image', async () => {
    const { client } = platform(
      () => new Response('<script>', { headers: { 'Content-Type': 'text/html' } }),
    )
    const relay = relayFor(client)

    const res = await relay.handle(call('/workspaces/mine/messages/m1/blocks/2/image'), {
      person: 'alice',
    })

    expect(res.status).toBe(404)
  })

  it('refuses a message checkMessage objects to, or one too large', async () => {
    const { client, calls } = platform()
    const relay = relayFor(client, {
      checkMessage: (body) => (body.includes('forbidden') ? 'not allowed' : undefined),
      maxBodyBytes: 64,
    })

    const refused = await relay.handle(
      call('/workspaces/mine/chat', { method: 'POST', body: '{"message":"forbidden"}' }),
      { person: 'alice' },
    )
    const tooLarge = await relay.handle(
      call('/workspaces/mine/chat', {
        method: 'POST',
        body: JSON.stringify({ message: 'x'.repeat(100) }),
      }),
      { person: 'alice' },
    )

    expect(refused.status).toBe(400)
    expect(await refused.json()).toEqual({ error: 'not allowed' })
    expect(tooLarge.status).toBe(413)
    expect(calls).toHaveLength(0)
  })

  it('tells onTurn about a turn in an existing session straight away', async () => {
    const { client } = platform()
    const onTurn = vi.fn()
    const relay = relayFor(client, { onTurn })

    await relay.handle(
      call('/workspaces/mine/chat', { method: 'POST', body: '{"message":"hi","session_id":"s1"}' }),
      { person: 'alice' },
    )

    expect(onTurn).toHaveBeenCalledWith(
      { person: 'alice' },
      { sessionId: 's1', message: 'hi', isNew: false },
    )
  })

  it('tells onTurn about a new session once the stream names it, streaming it whole to the page', async () => {
    const stream = 'data: {"type":"session.started","session_id":"s9"}\n\ndata: {"type":"done"}\n\n'
    const { client } = platform(
      () => new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }),
    )
    let told: unknown
    const relay = relayFor(client, {
      onTurn: (_ctx, turn) => {
        told = turn
      },
    })

    const res = await relay.handle(
      call('/workspaces/mine/chat', { method: 'POST', body: '{"message":"hello"}' }),
      { person: 'alice' },
    )

    expect(res.headers.get('Content-Type')).toBe('text/event-stream')
    expect(await res.text()).toBe(stream)
    await vi.waitFor(() => expect(told).toEqual({ sessionId: 's9', message: 'hello', isNew: true }))
  })

  it('reaches the agent proxy for a pending question', async () => {
    const { client, calls } = platform()
    const relay = relayFor(client)

    await relay.handle(call('/_proxy/agent/mine/sessions/s1/pending-question'), { person: 'alice' })

    expect(calls[0].path).toBe('/_proxy/agent/alice-ws/sessions/s1/pending-question')
  })

  it('answers 404 to a path it does not relay', async () => {
    const { client } = platform()
    const relay = relayFor(client)

    const res = await relay.handle(call('/workspaces/mine/files'), { person: 'alice' })

    expect(res.status).toBe(404)
  })
})
