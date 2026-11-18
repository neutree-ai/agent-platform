/**
 * Refresh behaviour of `getValidAccessToken` against an OAuth-proxy MCP server
 * that rotates the refresh token on every use and rejects the previous one
 * with `invalid_grant`. The DB pool is replaced by an in-memory single-row
 * table so concurrency between callers can be exercised without Postgres.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface Row {
  user_id: string
  server_origin: string
  access_token: string
  refresh_token: string | null
  token_type: string
  scope: string | null
  expires_at: Date | null
  updated_at: Date
  refresh_fail_count: number
  refresh_fail_first_at: Date | null
}

const ORIGIN = 'https://mcp.example.com'
const USER = 'u1'

let row: Row | null = null

vi.mock('./db/pool', () => ({
  pool: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('FROM mcp_oauth_clients')) {
        return {
          rows: [
            {
              server_origin: ORIGIN,
              metadata: { token_endpoint: `${ORIGIN}/token` },
              client_id: 'client',
              client_secret: null,
            },
          ],
        }
      }
      if (sql.startsWith('SELECT * FROM mcp_oauth_tokens')) {
        return { rows: row ? [{ ...row }] : [] }
      }
      if (sql.startsWith('INSERT INTO mcp_oauth_tokens')) {
        const [user_id, server_origin, access_token, refresh_token, token_type, scope, expires_at] =
          params as [string, string, string, string | null, string, string | null, Date]
        row = {
          user_id,
          server_origin,
          access_token,
          refresh_token: refresh_token ?? row?.refresh_token ?? null,
          token_type,
          scope,
          expires_at,
          updated_at: new Date(),
          refresh_fail_count: 0,
          refresh_fail_first_at: null,
        }
        return { rows: [] }
      }
      if (sql.includes('SET refresh_fail_count')) {
        if (!row) return { rows: [] }
        const resetMs = (params[2] as number) * 1000
        const stale =
          row.refresh_fail_first_at === null ||
          row.refresh_fail_first_at.getTime() < Date.now() - resetMs
        row.refresh_fail_count = stale ? 1 : row.refresh_fail_count + 1
        row.refresh_fail_first_at = stale ? new Date() : row.refresh_fail_first_at
        return {
          rows: [
            {
              refresh_fail_count: row.refresh_fail_count,
              refresh_fail_first_at: row.refresh_fail_first_at,
            },
          ],
        }
      }
      if (sql.startsWith('DELETE FROM mcp_oauth_tokens')) {
        const had = row !== null
        row = null
        return { rows: [], rowCount: had ? 1 : 0 }
      }
      throw new Error(`unexpected query: ${sql}`)
    }),
  },
}))

const { getValidAccessToken, McpOAuthReauthRequired } = await import('./mcp-oauth')

/** Token endpoint that rotates the refresh token and rejects reused ones. */
function rotatingTokenServer(initialRefresh: string) {
  let valid = initialRefresh
  let n = 0
  const calls: string[] = []
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const presented = new URLSearchParams(init.body as string).get('refresh_token') ?? ''
    calls.push(presented)
    // Let concurrent callers interleave before the server answers.
    await new Promise((r) => setTimeout(r, 5))
    if (presented !== valid) {
      return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 401 })
    }
    n += 1
    valid = `rt-${n}`
    return new Response(
      JSON.stringify({ access_token: `at-${n}`, refresh_token: valid, expires_in: 3600 }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  })
  return { fetchMock, calls }
}

function seed(overrides: Partial<Row> = {}) {
  row = {
    user_id: USER,
    server_origin: ORIGIN,
    access_token: 'at-0',
    refresh_token: 'rt-0',
    token_type: 'Bearer',
    scope: null,
    expires_at: new Date(Date.now() - 1000),
    updated_at: new Date(Date.now() - 3_600_000),
    refresh_fail_count: 0,
    refresh_fail_first_at: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('getValidAccessToken refresh', () => {
  it('refreshes once for concurrent callers of an expired token', async () => {
    seed()
    const server = rotatingTokenServer('rt-0')
    vi.stubGlobal('fetch', server.fetchMock)

    const tokens = await Promise.all(
      Array.from({ length: 5 }, () => getValidAccessToken(USER, ORIGIN)),
    )

    expect(tokens).toEqual(Array(5).fill('at-1'))
    expect(server.calls).toEqual(['rt-0'])
    expect(row?.refresh_token).toBe('rt-1')
    expect(row?.refresh_fail_count).toBe(0)
  })

  it('refreshes once for concurrent 401 retries carrying the same rejected token', async () => {
    seed({ expires_at: new Date(Date.now() + 3_000_000) })
    const server = rotatingTokenServer('rt-0')
    vi.stubGlobal('fetch', server.fetchMock)

    const tokens = await Promise.all(
      Array.from({ length: 4 }, () => getValidAccessToken(USER, ORIGIN, 'at-0')),
    )

    expect(tokens).toEqual(Array(4).fill('at-1'))
    expect(server.calls).toEqual(['rt-0'])
  })

  it('returns the stored token without refreshing when the rejected one was already replaced', async () => {
    seed({
      access_token: 'at-1',
      refresh_token: 'rt-1',
      expires_at: new Date(Date.now() + 3_000_000),
    })
    const server = rotatingTokenServer('rt-1')
    vi.stubGlobal('fetch', server.fetchMock)

    expect(await getValidAccessToken(USER, ORIGIN, 'at-0')).toBe('at-1')
    expect(server.calls).toEqual([])
  })

  it('uses the stored replacement instead of counting a failure when another refresher rotated first', async () => {
    seed()
    // The server already rotated rt-0 for another replica, which then stored
    // its result while our refresh with rt-0 was on the wire.
    const fetchMock = vi.fn(async () => {
      row = { ...(row as Row), access_token: 'at-other', refresh_token: 'rt-other' }
      return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 401 })
    })
    vi.stubGlobal('fetch', fetchMock)

    expect(await getValidAccessToken(USER, ORIGIN)).toBe('at-other')
    expect(row?.refresh_fail_count).toBe(0)
  })

  it('restarts a stale failure streak instead of dropping the token on one failure', async () => {
    seed({
      refresh_fail_count: 2,
      refresh_fail_first_at: new Date(Date.now() - 24 * 3_600_000),
    })
    const server = rotatingTokenServer('rt-dead')
    vi.stubGlobal('fetch', server.fetchMock)

    expect(await getValidAccessToken(USER, ORIGIN)).toBeNull()
    expect(row).not.toBeNull()
    expect(row?.refresh_fail_count).toBe(1)
  })

  it('still drops a token whose refresh keeps failing across the grace window', async () => {
    seed({
      refresh_fail_count: 2,
      refresh_fail_first_at: new Date(Date.now() - 15 * 60_000),
    })
    const server = rotatingTokenServer('rt-dead')
    vi.stubGlobal('fetch', server.fetchMock)

    await expect(getValidAccessToken(USER, ORIGIN)).rejects.toBeInstanceOf(McpOAuthReauthRequired)
    expect(row).toBeNull()
  })
})
