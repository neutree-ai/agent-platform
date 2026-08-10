import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The workspace data-plane routing seam. A workspace on a remote environment
// resolves to its localhost forward proxy; a built-in one to cluster DNS, whose
// shape depends on the runtime mode — a ClusterIP Service for the static shape,
// per-ordinal headless DNS for auto-scaling.

const { getRemoteProxyPortMock, anyReadyReplicaMock, readyReplicaIdsMock, runtimeModeOfMock } =
  vi.hoisted(() => ({
    getRemoteProxyPortMock:
      vi.fn<(workspaceId: string, replicaId?: number) => number | undefined>(),
    anyReadyReplicaMock: vi.fn<(workspaceId: string) => number | undefined>(),
    readyReplicaIdsMock: vi.fn<(workspaceId: string) => readonly number[]>(),
    runtimeModeOfMock: vi.fn<(workspaceId: string) => 'static' | 'auto-scaling' | undefined>(),
  }))

vi.mock('./remote-proxy', () => ({
  getRemoteProxyPort: getRemoteProxyPortMock,
}))

vi.mock('../services/replica-router', () => ({
  anyReadyReplica: anyReadyReplicaMock,
  readyReplicaIds: readyReplicaIdsMock,
  runtimeModeOf: runtimeModeOfMock,
}))

import {
  getWorkspaceAddress,
  notifyAgentReload,
  postToAgent,
  resolveAgentAddress,
} from './workspace-address'

const SERVICE = 'http://tos-ws1.default.svc.cluster.local:3001'
const HEADLESS = 'http://tos-ws1-hl.default.svc.cluster.local:3001'
const replica = (id: number) => `http://tos-ws1-${id}.tos-ws1-hl.default.svc.cluster.local:3001`

beforeEach(() => {
  getRemoteProxyPortMock.mockReturnValue(undefined)
  anyReadyReplicaMock.mockReturnValue(undefined)
  readyReplicaIdsMock.mockReturnValue([])
  runtimeModeOfMock.mockReturnValue('static')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('getWorkspaceAddress', () => {
  it('resolves a static workspace to its ClusterIP Service', () => {
    expect(getWorkspaceAddress('ws1')).toBe(SERVICE)
  })

  // A static workspace has exactly one replica and its Service already points at
  // it, so a replica id says nothing new. It reports a ready set like every other
  // workspace, so ids DO reach here — and per-ordinal DNS, which the static shape
  // never creates, would NXDOMAIN.
  it('ignores a replica id for a static workspace', () => {
    anyReadyReplicaMock.mockReturnValue(0)

    expect(getWorkspaceAddress('ws1')).toBe(SERVICE)
    expect(getWorkspaceAddress('ws1', 0)).toBe(SERVICE)
  })

  it('resolves a named replica of an auto-scaling workspace to its per-ordinal DNS', () => {
    runtimeModeOfMock.mockReturnValue('auto-scaling')

    expect(getWorkspaceAddress('ws1', 2)).toBe(replica(2))
  })

  // An auto-scaling workspace has no ClusterIP Service — a VIP would round-robin
  // across replicas and defeat session affinity — so a call with no replica
  // affinity goes to whichever one is ready.
  it('resolves an unbound call on an auto-scaling workspace to any ready replica', () => {
    runtimeModeOfMock.mockReturnValue('auto-scaling')
    anyReadyReplicaMock.mockReturnValue(1)

    expect(getWorkspaceAddress('ws1')).toBe(replica(1))
  })

  // Scaled to zero or cold-starting: the headless Service names pods as k8s marks
  // them ready, so the first health poll lands without waiting for cp's next
  // observation. The ClusterIP name would NXDOMAIN for the whole cold start.
  it('resolves an auto-scaling workspace with nothing ready to its headless Service', () => {
    runtimeModeOfMock.mockReturnValue('auto-scaling')
    anyReadyReplicaMock.mockReturnValue(undefined)

    expect(getWorkspaceAddress('ws1')).toBe(HEADLESS)
  })

  // A workspace created since the last router refresh has no known shape. Its
  // Service is what a workspace has unless it is auto-scaling.
  it('resolves a workspace of unknown shape to its Service', () => {
    runtimeModeOfMock.mockReturnValue(undefined)

    expect(getWorkspaceAddress('ws1')).toBe(SERVICE)
  })

  it('resolves remote workspaces to their localhost forward proxy', () => {
    getRemoteProxyPortMock.mockReturnValue(41234)

    expect(getWorkspaceAddress('ws1')).toBe('http://127.0.0.1:41234')
  })
})

describe('resolveAgentAddress', () => {
  it('matches the default address when no replica is bound', () => {
    const expected = getWorkspaceAddress('ws1')

    expect(resolveAgentAddress('ws1')).toBe(expected)
    expect(resolveAgentAddress('ws1', {})).toBe(expected)
    expect(resolveAgentAddress('ws1', { sessionId: null })).toBe(expected)
    expect(resolveAgentAddress('ws1', { sessionId: 'sess-1' })).toBe(expected)
    expect(resolveAgentAddress('ws1', { sessionId: 'sess-1', replicaId: null })).toBe(expected)
  })

  it('routes a replica-bound session to that replica', () => {
    runtimeModeOfMock.mockReturnValue('auto-scaling')

    expect(resolveAgentAddress('ws1', { sessionId: 'sess-1', replicaId: 0 })).toBe(replica(0))
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
    expect(url).toBe(`${SERVICE}/reload-config`)
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

  // The reload mutates a per-process cache, so every ready replica has to get it.
  it('fans out to every ready replica of an auto-scaling workspace', async () => {
    runtimeModeOfMock.mockReturnValue('auto-scaling')
    readyReplicaIdsMock.mockReturnValue([0, 1, 2])
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await notifyAgentReload('ws1', ['config'])).toBe(true)
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      `${replica(0)}/reload-config`,
      `${replica(1)}/reload-config`,
      `${replica(2)}/reload-config`,
    ])
  })

  // A running static workspace reports one ready replica like any other, and the
  // fan-out over it lands on the workspace's Service — one call, one process.
  it('reaches a running static workspace once, through its Service', async () => {
    readyReplicaIdsMock.mockReturnValue([0])
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await notifyAgentReload('ws1', ['config'])).toBe(true)
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([`${SERVICE}/reload-config`])
  })

  it('reports false when any replica in the fan-out fails (caller retries)', async () => {
    runtimeModeOfMock.mockReturnValue('auto-scaling')
    readyReplicaIdsMock.mockReturnValue([0, 1])
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response('err', { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await notifyAgentReload('ws1', ['config'])).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
