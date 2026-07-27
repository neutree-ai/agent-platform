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
vi.mock('../db/sessions', () => ({
  getSession: vi.fn(),
  transitionSessionStatus: vi.fn(),
  takePendingMessage: vi.fn(),
  restorePendingMessage: vi.fn(),
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

  it('releases the slot on an early return (session belongs to another workspace)', async () => {
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
