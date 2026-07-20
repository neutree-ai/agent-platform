import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The workspace data-plane routing seam: builtin workspaces resolve to
// cluster DNS, remote (BYOI) workspaces to their localhost forward proxy, and
// resolveAgentAddress must stay identity-equal to getWorkspaceAddress for
// every route context while workspaces are single-replica.

const { getRemoteProxyPortMock } = vi.hoisted(() => ({
  getRemoteProxyPortMock: vi.fn<(workspaceId: string, replicaId?: number) => number | undefined>(),
}))

vi.mock('./remote-proxy', () => ({
  getRemoteProxyPort: getRemoteProxyPortMock,
}))

import {
  getWorkspaceAddress,
  notifyAgentReload,
  postToAgent,
  resolveAgentAddress,
} from './workspace-address'

beforeEach(() => {
  getRemoteProxyPortMock.mockReturnValue(undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('getWorkspaceAddress', () => {
  it('resolves builtin workspaces to cluster DNS', () => {
    expect(getWorkspaceAddress('ws1')).toBe('http://tos-ws1.default.svc.cluster.local:3001')
  })

  it('resolves a specific replica to its per-ordinal headless DNS', () => {
    expect(getWorkspaceAddress('ws1', 2)).toBe(
      'http://tos-ws1-2.tos-ws1-hl.default.svc.cluster.local:3001',
    )
  })

  it('resolves remote workspaces to their localhost forward proxy', () => {
    getRemoteProxyPortMock.mockReturnValue(41234)
    expect(getWorkspaceAddress('ws1')).toBe('http://127.0.0.1:41234')
  })
})

describe('resolveAgentAddress', () => {
  it('matches the default builtin address when no replica is bound', () => {
    const expected = getWorkspaceAddress('ws1')
    expect(resolveAgentAddress('ws1')).toBe(expected)
    expect(resolveAgentAddress('ws1', {})).toBe(expected)
    expect(resolveAgentAddress('ws1', { sessionId: null })).toBe(expected)
    expect(resolveAgentAddress('ws1', { sessionId: 'sess-1' })).toBe(expected)
    expect(resolveAgentAddress('ws1', { sessionId: 'sess-1', replicaId: null })).toBe(expected)
  })

  it('routes a replica-bound session to that replica', () => {
    expect(resolveAgentAddress('ws1', { sessionId: 'sess-1', replicaId: 0 })).toBe(
      'http://tos-ws1-0.tos-ws1-hl.default.svc.cluster.local:3001',
    )
  })

  it('follows the remote-proxy path too', () => {
    getRemoteProxyPortMock.mockReturnValue(41234)
    expect(resolveAgentAddress('ws1', { sessionId: 'sess-1' })).toBe('http://127.0.0.1:41234')
  })

  it('routes a replica-bound remote session to that replica’s proxy', () => {
    // proxy exists only for replica 2 → a turn bound to 2 reaches it, others miss
    getRemoteProxyPortMock.mockImplementation((_ws, id) => (id === 2 ? 41250 : undefined))
    expect(resolveAgentAddress('ws1', { sessionId: 'sess-1', replicaId: 2 })).toBe(
      'http://127.0.0.1:41250',
    )
    expect(getRemoteProxyPortMock).toHaveBeenCalledWith('ws1', 2)
  })
})

describe('postToAgent', () => {
  it('POSTs JSON to the resolved agent address', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const resp = await postToAgent('ws1', '/reload-config', { scope: ['skills'] }, 1_000)

    expect(resp?.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://tos-ws1.default.svc.cluster.local:3001/reload-config')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ scope: ['skills'] })
  })

  it('returns null instead of throwing when the agent is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    expect(await postToAgent('ws1', '/reload-config', {}, 1_000)).toBeNull()
  })
})

describe('notifyAgentReload', () => {
  it('true when the agent acknowledges', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })))
    expect(await notifyAgentReload('ws1', ['skills'])).toBe(true)
  })

  it('false on non-2xx and on unreachable agent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('err', { status: 500 })))
    expect(await notifyAgentReload('ws1', ['skills'])).toBe(false)

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    expect(await notifyAgentReload('ws1', ['config'])).toBe(false)
  })
})
