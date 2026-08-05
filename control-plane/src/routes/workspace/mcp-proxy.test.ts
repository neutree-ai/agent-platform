import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/db/workspace-tokens', () => ({ verifyWorkspaceToken: vi.fn() }))
vi.mock('../../services/db/workspaces', () => ({
  getWorkspace: vi.fn(),
  getWorkspaceConfig: vi.fn(),
}))
vi.mock('../../services/mcp-oauth', () => ({
  getValidAccessToken: vi.fn(),
  serverOriginFromUrl: vi.fn(),
  McpOAuthReauthRequired: class extends Error {},
}))
vi.mock('../../lib/session-token', () => ({ resolveTokenForUser: vi.fn() }))

import { verifyWorkspaceToken } from '../../services/db/workspace-tokens'
import { getWorkspace } from '../../services/db/workspaces'
import { getValidAccessToken } from '../../services/mcp-oauth'
import ws from './index'

const verify = vi.mocked(verifyWorkspaceToken)
const workspace = vi.mocked(getWorkspace)
const accessToken = vi.mocked(getValidAccessToken)

const UPSTREAM = 'https://mcp.example.com'
const encoded = Buffer.from(UPSTREAM).toString('base64url')

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  verify.mockReset()
  workspace.mockReset()
  accessToken.mockReset()
  workspace.mockResolvedValue({ id: 'ws1', user_id: 'alice' } as never)
  accessToken.mockResolvedValue('alice-upstream-token' as never)
  fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})

function call(path: string, token?: string) {
  return ws.request(path, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
}

describe('MCP proxy', () => {
  it("attaches the calling workspace owner's upstream token", async () => {
    verify.mockResolvedValue({ workspaceId: 'ws1', userId: 'alice' })

    const res = await call(`/v1/mcp/${encoded}/mcp`, 'ws_good')

    expect(res.status).toBe(200)
    // Whose tokens to use came from the principal, not from the URL — and
    // without re-reading the workspace the token check already read.
    expect(workspace).not.toHaveBeenCalled()
    expect(accessToken).toHaveBeenCalledWith('alice', UPSTREAM)

    const [target, init] = fetchMock.mock.calls[0]
    expect(target).toBe(`${UPSTREAM}/mcp`)
    expect((init.headers as Headers).get('Authorization')).toBe('Bearer alice-upstream-token')
  })

  // The point of the move. The old URL spelled the owner out in a path segment,
  // so editing it borrowed someone else's upstream access.
  it('offers no way to ask for another user, the path having no say', async () => {
    verify.mockResolvedValue({ workspaceId: 'ws1', userId: 'alice' })

    await call(`/v1/mcp/${encoded}/mcp`, 'ws_good')

    // 'bob' appears nowhere: there is no path segment left to put him in.
    expect(accessToken).toHaveBeenCalledWith('alice', UPSTREAM)
    expect(accessToken).not.toHaveBeenCalledWith('bob', expect.anything())
  })

  it('rejects an unauthenticated caller before reaching any token', async () => {
    const res = await call(`/v1/mcp/${encoded}/mcp`)

    expect(res.status).toBe(401)
    expect(accessToken).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // A workspace that no longer exists takes its tokens with it: verify JOINs
  // workspaces, so the token stops resolving and the request never gets in.
  it('rejects a token whose workspace is gone', async () => {
    verify.mockResolvedValue(null)

    const res = await call(`/v1/mcp/${encoded}/mcp`, 'ws_stale')

    expect(res.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not claim an encoding for a body fetch already decoded', async () => {
    verify.mockResolvedValue({ workspaceId: 'ws1', userId: 'alice' })
    // What an ingress that gzips JSON hands to `fetch`: the header survives on
    // the Response, the body arrives decoded. Re-sending the header left the
    // client waiting for the rest of a gzip member that was never coming.
    fetchMock.mockResolvedValue(
      new Response('{"jsonrpc":"2.0"}', {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'content-encoding': 'gzip',
          'content-length': '42',
        },
      }),
    )

    const res = await call(`/v1/mcp/${encoded}/mcp`, 'ws_good')

    expect(res.headers.get('content-encoding')).toBeNull()
    expect(res.headers.get('content-length')).toBeNull()
    expect(res.headers.get('content-type')).toBe('application/json')
    expect(await res.text()).toBe('{"jsonrpc":"2.0"}')
  })
})
