import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./db/workspaces', () => ({ getWorkspace: vi.fn() }))
vi.mock('./db/shares', () => ({ getPlatformToken: vi.fn(async () => 'owner-token') }))

vi.stubEnv('SANDBOX_SERVICE_URL', 'http://svc')
vi.stubEnv('SANDBOX_MAX_PER_WORKSPACE', '2')
vi.stubEnv('SANDBOX_MAX_LIFETIME_SECONDS', '1800')

const { SandboxLimitError, workspaceSandboxes } = await import('./sandbox-provider')

/** Sandboxes the stub sandbox service holds: ID → state. */
let held: Record<string, string> = {}
const created: unknown[] = []
const later = () => new Date(Date.now() + 20 * 60_000).toISOString()

function raw(id: string) {
  return {
    id,
    status: { state: held[id] },
    image: { uri: 'node:22' },
    expiresAt: later(),
    metadata: { workspace_id: 'ws1' },
  }
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
}

vi.stubGlobal(
  'fetch',
  vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input)
    const method = init.method ?? 'GET'
    if (url.pathname === '/api/sandboxes' && method === 'GET') {
      return json({ items: Object.keys(held).map(raw) })
    }
    if (url.pathname === '/api/sandboxes' && method === 'POST') {
      created.push(JSON.parse(String(init.body)))
      held.new = 'Running'
      return json(raw('new'))
    }
    if (url.pathname.endsWith('/renew')) return json({ expiresAt: later() })
    const id = url.pathname.split('/')[3]
    return json(raw(id))
  }),
)

const ws = { id: 'ws1', user_id: 'u1' }

beforeEach(() => {
  held = {}
  created.length = 0
})

describe('workspace sandbox limits', () => {
  it('states the lifetime cap and fills it in as the default', async () => {
    const sandboxes = workspaceSandboxes(ws)
    expect(sandboxes.capabilities.timeout).toMatchObject({ defaultSeconds: 1800, maxSeconds: 1800 })
    await sandboxes.create({ image: 'node:22' })
    expect(created[0]).toMatchObject({ timeoutSeconds: 1800 })
    await expect(
      sandboxes.create({ image: 'node:22', timeoutSeconds: 3600 }),
    ).rejects.toBeInstanceOf(SandboxLimitError)
  })

  it('counts only live sandboxes against the per-workspace limit', async () => {
    held = { a: 'Running', b: 'Deleted', c: 'Error' }
    const sandboxes = workspaceSandboxes(ws)
    await sandboxes.create({ image: 'node:22' })
    held.d = 'Creating'
    await expect(sandboxes.create({ image: 'node:22' })).rejects.toThrow('kill one first')
  })

  it('refuses a renewal past the lifetime cap', async () => {
    held = { a: 'Running' }
    const sandboxes = workspaceSandboxes(ws)
    await expect(sandboxes.renew?.('a', 600)).resolves.toBeTruthy()
    await expect(sandboxes.renew?.('a', 900)).rejects.toBeInstanceOf(SandboxLimitError)
  })
})
