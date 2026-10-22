import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppClient } from './apps.js'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function setup(expiresIn = 3600) {
  let issued = 0
  const fetchMock = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
    const path = String(url).replace('https://nap.test', '')
    if (path.endsWith('/token'))
      return json({ access_token: `tok-${++issued}`, expires_in: expiresIn })
    if (path.startsWith('/apps/v1/users/')) return json({ id: 'u1', external_id: 'stu-1' }, 201)
    if (path === '/api/workspaces') return json([{ id: 'w1', slug: 'main' }])
    return json({ error: 'unexpected' }, 500)
  })
  const app = new AppClient({
    baseUrl: 'https://nap.test/',
    clientId: 'the-app',
    clientSecret: 's3cret',
    fetch: fetchMock as typeof fetch,
  })
  return { app, fetchMock, issued: () => issued }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('AppClient', () => {
  it('provisions a user with the client credentials', async () => {
    const { app, fetchMock } = setup()

    await app.upsertUser('stu 1', { displayName: 'Student One' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://nap.test/apps/v1/users/stu%201')
    expect(init?.method).toBe('PUT')
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      `Basic ${btoa('the-app:s3cret')}`,
    )
    expect(JSON.parse(init?.body as string)).toEqual({ display_name: 'Student One', email: null })
  })

  it('reuses a token until shortly before it expires', async () => {
    vi.useFakeTimers()
    const { app, issued } = setup(3600)

    expect(await app.userToken('stu-1')).toBe('tok-1')
    expect(await app.userToken('stu-1')).toBe('tok-1')
    vi.advanceTimersByTime(3600_000 - 30_000)
    expect(await app.userToken('stu-1')).toBe('tok-2')
    expect(issued()).toBe(2)
  })

  it('shares one exchange between concurrent requests', async () => {
    const { app, issued } = setup()

    const tokens = await Promise.all([1, 2, 3].map(() => app.userToken('stu-1')))

    expect(new Set(tokens)).toEqual(new Set(['tok-1']))
    expect(issued()).toBe(1)
  })

  it('acts as the user through as()', async () => {
    const { app, fetchMock } = setup()

    await app.as('stu-1').workspaceOfSlug('main')

    const [url, init] = fetchMock.mock.calls.at(-1)!
    expect(url).toBe('https://nap.test/api/workspaces')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer tok-1')
  })
})
