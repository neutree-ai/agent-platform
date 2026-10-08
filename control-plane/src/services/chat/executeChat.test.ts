import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Workspace } from '../db/types'

// This suite guards the admission-slot lifecycle in executeChat: a turn is
// admitted (acquireTurn) before setup work, and the slot must be released on
// EVERY exit — including a throw during setup, before the streaming interceptor
// takes ownership. A missed release silently shrinks an auto-scaling workspace's
// capacity (readyReplicas × max_concurrency − leaked). We use the REAL turn gate
// and replica router so the assertion is the actual in-memory active count.

vi.mock('../workspace-autostart', () => ({
  ensureWorkspaceRunning: vi.fn().mockResolvedValue(undefined),
  WorkspaceStartError: class WorkspaceStartError extends Error {},
}))
// Stands in for the claim columns on the sessions row: session id → holder.
const claimRows = vi.hoisted(() => new Map<string, string>())
vi.mock('../db/sessions', () => ({
  getSession: vi.fn(),
  transitionSessionStatus: vi.fn(),
  takePendingMessage: vi.fn(),
  restorePendingMessage: vi.fn(),
  claimSessionTurn: vi.fn(async (sid: string, token: string) => {
    if (claimRows.has(sid)) return false
    claimRows.set(sid, token)
    return true
  }),
  adoptSessionTurn: vi.fn(async (sid: string, token: string) => {
    claimRows.set(sid, token)
  }),
  renewSessionTurn: vi.fn(async (sid: string, token: string) => claimRows.get(sid) === token),
  releaseSessionTurn: vi.fn(async (sid: string, token: string) => {
    if (claimRows.get(sid) === token) claimRows.delete(sid)
  }),
}))
vi.mock('../../lib/session-token', () => ({
  ensureTokenForSession: vi.fn().mockResolvedValue('tok'),
  mintToken: vi.fn().mockResolvedValue('tok'),
}))
vi.mock('../../lib/workspace-address', () => ({
  resolveAgentAddress: vi.fn().mockReturnValue('http://agent'),
}))
vi.mock('../db/messages', () => ({
  addMessage: vi.fn().mockResolvedValue({ id: 'm1' }),
  insertUserMessageBlocks: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../db/teamwork', () => ({ addTeamworkSession: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../db/workspaces', () => ({ getWorkspace: vi.fn() }))
vi.mock('../../lib/sse', () => ({
  createInterceptedSSEResponse: vi.fn().mockReturnValue(new Response('ok')),
}))

const { executeChat } = await import('./executeChat')
const { getSession, transitionSessionStatus } = await import('../db/sessions')
const { turnDemand, __resetTurnGate } = await import('./turn-gate')
const { createInterceptedSSEResponse } = await import('../../lib/sse')
const { syncReadyReplicas, __resetReplicaRouter } = await import('../replica-router')

const WS = 'ws1'
const workspace = { id: WS, status: 'running' } as unknown as Workspace

// Seed the gate with a real, generous capacity so acquireTurn admits immediately
// (readyReplicas 1 × perReplicaCapacity 5). turnDemand.active then reflects the
// live slot count for this workspace.
function seedCapacity() {
  syncReadyReplicas(new Map([[WS, { ids: [0], perReplicaCapacity: 5 }]]))
}

// An SSE response, so executeChat takes the streaming path (past the setup
// awaits that this suite makes throw / succeed).
const sseResponse = () =>
  new Response('data: {}\n\n', { headers: { 'Content-Type': 'text/event-stream' } })

beforeEach(() => {
  vi.clearAllMocks()
  __resetTurnGate()
  claimRows.clear()
  __resetReplicaRouter()
  seedCapacity()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse()))
  vi.mocked(getSession).mockResolvedValue({
    id: 's1',
    workspace_id: WS,
    replica_ordinal: 0,
  } as never)
})

describe('executeChat admission-slot release', () => {
  it('releases the slot when a setup step throws after admission (no capacity leak)', async () => {
    // Inject a transient failure at transitionSessionStatus — a setup await that
    // runs after the slot is acquired but before the interceptor owns it.
    vi.mocked(transitionSessionStatus).mockRejectedValueOnce(new Error('db blip'))

    expect(turnDemand(WS).active).toBe(0)
    await expect(
      executeChat({ workspace, message: 'hi', sessionId: 's1', images: null, source: 'api' }),
    ).rejects.toThrow('db blip')

    // The slot must be back — a leak would leave active at 1 forever.
    expect(turnDemand(WS).active).toBe(0)
  })

  it('keeps the slot held on the streaming handoff (interceptor owns onTurnEnd)', async () => {
    vi.mocked(transitionSessionStatus).mockResolvedValue(undefined)

    const resp = await executeChat({
      workspace,
      message: 'hi',
      sessionId: 's1',
      images: null,
      source: 'api',
    })

    // Handed off to the interceptor: the finally must NOT release it here, or the
    // gate would double-count capacity as free while the turn is still running.
    expect(resp).toBeInstanceOf(Response)
    expect(turnDemand(WS).active).toBe(1)
  })

  it('takes no slot for a session that belongs to another workspace', async () => {
    vi.mocked(getSession).mockResolvedValue({
      id: 's1',
      workspace_id: 'other-ws',
      replica_ordinal: 0,
    } as never)

    const resp = await executeChat({
      workspace,
      message: 'hi',
      sessionId: 's1',
      images: null,
      source: 'api',
    })

    expect(resp.status).toBe(400)
    expect(turnDemand(WS).active).toBe(0)
  })
})

// One turn per session: the agent and cp both key a turn's plumbing by session
// id, so a second turn arriving while one runs loses a reply. executeChat turns
// it away instead, and lets it in again once the first turn has settled.
describe('executeChat one turn per session', () => {
  const chat = (sessionId: string | null) =>
    executeChat({ workspace, message: 'hi', sessionId, images: null, source: 'web' })
  const lastInterceptOpts = () => vi.mocked(createInterceptedSSEResponse).mock.calls.at(-1)?.[1]

  beforeEach(() => {
    vi.mocked(transitionSessionStatus).mockResolvedValue(undefined)
    vi.mocked(getSession).mockImplementation(async (id: string) =>
      id === 'gone' ? null : ({ id, workspace_id: WS, replica_ordinal: 0 } as never),
    )
  })

  it('turns away a second turn while one is running', async () => {
    await chat('s1')
    const resp = await chat('s1')

    expect(resp.status).toBe(409)
    expect(await resp.json()).toMatchObject({ code: 'session_busy' })
    expect(fetch).toHaveBeenCalledTimes(1)
    // The refused turn took no admission slot.
    expect(turnDemand(WS).active).toBe(1)
  })

  it('admits the next turn once the running one has settled', async () => {
    await chat('s1')
    await lastInterceptOpts()?.onSessionSettled?.()

    const resp = await chat('s1')

    expect(resp.status).toBe(200)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('does not hold the session after a setup failure', async () => {
    vi.mocked(transitionSessionStatus).mockRejectedValueOnce(new Error('db blip'))
    await expect(chat('s1')).rejects.toThrow('db blip')

    expect(claimRows.has('s1')).toBe(false)
    expect((await chat('s1')).status).toBe(200)
  })

  it('leaves other sessions alone', async () => {
    await chat('s1')

    expect((await chat('s2')).status).toBe(200)
  })

  it('claims a new session once it has an id', async () => {
    await chat(null)
    await lastInterceptOpts()?.onNewSession?.('fresh')

    expect((await chat('fresh')).status).toBe(409)
  })

  it('does not claim a session that is not in the workspace', async () => {
    const resp = await chat('gone')

    expect(resp.status).toBe(400)
    expect(claimRows.has('gone')).toBe(false)
  })
})
