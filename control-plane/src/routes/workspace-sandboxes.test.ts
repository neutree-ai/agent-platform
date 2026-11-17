import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppEnv } from '../lib/types'

const getWorkspace = vi.hoisted(() => vi.fn())

vi.mock('../services/db/workspaces', () => ({ getWorkspace }))
vi.mock('../services/db/shares', () => ({ getPlatformToken: vi.fn(async () => 'owner-token') }))
vi.mock('../lib/workspace-access', () => ({ canAccessWorkspace: vi.fn(async () => true) }))

vi.stubEnv('SANDBOX_SERVICE_URL', 'http://svc')
vi.stubEnv('SANDBOX_PUBLIC_URL', 'https://sandbox.example.com')

const { default: workspaceSandboxes } = await import('./workspace-sandboxes')

/** Sandboxes the stub sandbox service holds, keyed by ID. */
const sandboxes = new Map<string, { workspace_id: string }>()
const requests: { method: string; path: string; body: any }[] = []

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function raw(id: string) {
  return {
    id,
    status: { state: 'Running', reason: '' },
    image: { uri: 'node:22' },
    entrypoint: [],
    createdAt: 'C',
    expiresAt: 'E',
    metadata: { workspace_id: sandboxes.get(id)?.workspace_id ?? '' },
  }
}

vi.stubGlobal(
  'fetch',
  vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input)
    const method = init.method ?? 'GET'
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    requests.push({ method, path: `${url.pathname}${url.search}`, body })
    const [, , , id, action] = url.pathname.split('/')
    if (method === 'POST' && !id) {
      sandboxes.set('new', { workspace_id: body.metadata.workspace_id })
      return json(raw('new'))
    }
    if (method === 'GET' && !id) {
      const ws = url.searchParams.get('metadata.workspace_id')
      return json({
        items: [...sandboxes.keys()].filter((k) => sandboxes.get(k)?.workspace_id === ws).map(raw),
        pagination: {},
      })
    }
    if (!sandboxes.has(id)) return json({ error: 'not found' }, 404)
    if (action === 'renew') return json({ expiresAt: 'E2' })
    if (action === 'exec') {
      return body.background
        ? json({ commandId: 'c1' })
        : json({ stdout: 'out', stderr: '', exitCode: 0, executionTimeMs: 5 })
    }
    if (action === 'commands' && url.pathname.endsWith('/logs')) {
      return json({ content: 'log', cursor: 3 })
    }
    if (action === 'commands' && url.pathname.endsWith('/interrupt')) {
      return new Response(null, { status: 204 })
    }
    if (action === 'commands') {
      return json({ id: 'c1', running: false, exitCode: 0, startedAt: 'S', finishedAt: 'F' })
    }
    if (action === 'files' && url.pathname.endsWith('/dir')) {
      return json({ files: [{ path: '/a', type: 'file', size: 1, modifiedAt: 'M' }] })
    }
    if (action === 'files' && method === 'GET') return json({ content: 'text' })
    if (action === 'files') return new Response(null, { status: 204 })
    if (method === 'DELETE') return new Response(null, { status: 204 })
    return json(raw(id))
  }),
)

function buildApp() {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('user', { sub: 'u1', role: 'user', username: 'u1', name: 'u1', exp: 0 })
    await next()
  })
  app.route('/workspaces', workspaceSandboxes)
  return app
}

const app = buildApp()

beforeEach(() => {
  sandboxes.clear()
  sandboxes.set('mine', { workspace_id: 'ws1' })
  sandboxes.set('theirs', { workspace_id: 'ws2' })
  requests.length = 0
  getWorkspace.mockResolvedValue({ id: 'ws1', user_id: 'u1' })
})

describe('workspace sandbox routes', () => {
  it('creates a sandbox tagged with the workspace and returns it normalized', async () => {
    const res = await app.request('/workspaces/ws1/sandboxes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image: 'node:22', entrypoint: ['serve'] }),
    })
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({
      id: 'new',
      status: 'running',
      image: 'node:22',
      createdAt: 'C',
      expiresAt: 'E',
      metadata: { workspace_id: 'ws1' },
    })
    expect(requests[0].body).toMatchObject({
      image: 'node:22',
      entrypoint: ['serve'],
      metadata: { workspace_id: 'ws1' },
    })
  })

  it('lists only the workspace sandboxes', async () => {
    const res = await app.request('/workspaces/ws1/sandboxes')
    const body = (await res.json()) as { items: { id: string; status: string }[] }
    expect(body.items.map((s) => [s.id, s.status])).toEqual([['mine', 'running']])
  })

  it('renews, previews and kills its own sandbox', async () => {
    const renew = await app.request('/workspaces/ws1/sandboxes/mine/renew', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ extend_seconds: 60 }),
    })
    expect(await renew.json()).toEqual({ sandbox_id: 'mine', expires_at: 'E2' })

    const endpoint = await app.request('/workspaces/ws1/sandboxes/mine/endpoint/3000')
    expect(await endpoint.json()).toEqual({
      sandbox_id: 'mine',
      port: 3000,
      url: 'https://mine-3000.sandbox.example.com/',
    })

    const del = await app.request('/workspaces/ws1/sandboxes/mine', { method: 'DELETE' })
    expect(del.status).toBe(200)
    expect(requests.at(-1)).toMatchObject({ method: 'DELETE', path: '/api/sandboxes/mine' })
  })

  it('runs commands and reads their status and output', async () => {
    const post = (path: string, body: unknown) =>
      app.request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    const fg = await post('/workspaces/ws1/sandboxes/mine/commands', { command: 'ls' })
    expect(await fg.json()).toEqual({
      stdout: 'out',
      stderr: '',
      exit_code: 0,
      execution_time_ms: 5,
    })

    const bg = await post('/workspaces/ws1/sandboxes/mine/commands', {
      command: 'serve',
      background: true,
    })
    expect(await bg.json()).toEqual({ command_id: 'c1' })

    const status = await app.request('/workspaces/ws1/sandboxes/mine/commands/c1')
    expect(await status.json()).toEqual({
      command_id: 'c1',
      running: false,
      exit_code: 0,
      started_at: 'S',
      finished_at: 'F',
    })

    const logs = await app.request('/workspaces/ws1/sandboxes/mine/commands/c1/logs?cursor=1')
    expect(await logs.json()).toEqual({ content: 'log', cursor: 3 })
    expect(requests.at(-1)?.path).toBe('/api/sandboxes/mine/commands/c1/logs?cursor=1')

    const interrupt = await post('/workspaces/ws1/sandboxes/mine/commands/c1/interrupt', {})
    expect(await interrupt.json()).toEqual({ success: true })
  })

  it('writes, reads and lists files', async () => {
    const write = await app.request('/workspaces/ws1/sandboxes/mine/files', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ files: [{ path: '/a', content: 'x' }] }),
    })
    expect(write.status).toBe(200)
    expect(requests.at(-1)?.body).toEqual({ files: [{ path: '/a', content: 'x' }] })

    const read = await app.request('/workspaces/ws1/sandboxes/mine/files?path=/a&limit=10')
    expect(await read.json()).toEqual({ content: 'text' })

    const dir = await app.request('/workspaces/ws1/sandboxes/mine/directory?path=/')
    expect(await dir.json()).toEqual({
      files: [{ path: '/a', type: 'file', size: 1, modified_at: 'M' }],
    })
  })

  it("reports another workspace's sandbox as not found and leaves it alone", async () => {
    for (const [method, path] of [
      ['POST', '/workspaces/ws1/sandboxes/theirs/renew'],
      ['GET', '/workspaces/ws1/sandboxes/theirs/commands/c1'],
      ['GET', '/workspaces/ws1/sandboxes/theirs/files?path=/a'],
      ['GET', '/workspaces/ws1/sandboxes/theirs/directory?path=/'],
      ['GET', '/workspaces/ws1/sandboxes/theirs/endpoint/3000'],
      ['DELETE', '/workspaces/ws1/sandboxes/theirs'],
    ] as const) {
      const res = await app.request(path, { method })
      expect(res.status, path).toBe(404)
    }
    expect(requests.filter((r) => r.method !== 'GET')).toEqual([])
  })

  it('rejects a bad port', async () => {
    const res = await app.request('/workspaces/ws1/sandboxes/mine/endpoint/99999')
    expect(res.status).toBe(400)
  })
})
