import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  claimQueuedMessage: vi.fn(),
  finishQueuedMessage: vi.fn(),
  listQueuedSessions: vi.fn(),
  renewQueuedMessage: vi.fn(),
}))
vi.mock('../db/session-message-queue', () => db)
vi.mock('../db/workspaces', () => ({ getWorkspace: vi.fn().mockResolvedValue({ id: 'ws' }) }))
vi.mock('../../lib/sse', () => ({ isDraining: () => false }))

const { drainSessionMessageQueue, startSessionMessageQueue } = await import('./message-queue')
const payload = { message: 'approved', images: [], source: 'webhook', callerUserId: 'caller' }

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  db.claimQueuedMessage.mockResolvedValue({ id: '1', payload })
  db.finishQueuedMessage.mockResolvedValue(undefined)
  db.renewQueuedMessage.mockResolvedValue(undefined)
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('session message queue delivery', () => {
  it('leaves a busy session queued, then delivers with its original identity and source', async () => {
    const start = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 409 }))
    await drainSessionMessageQueue('ws', 's1', start)
    expect(db.finishQueuedMessage).toHaveBeenLastCalledWith('1', expect.any(String), false)

    start.mockResolvedValueOnce(
      new Response('data: {}\n\n', { headers: { 'Content-Type': 'text/event-stream' } }),
    )
    await drainSessionMessageQueue('ws', 's1', start)
    expect(start).toHaveBeenLastCalledWith({ workspace: { id: 'ws' }, sessionId: 's1', ...payload })
    expect(db.finishQueuedMessage).toHaveBeenLastCalledWith('1', expect.any(String), true)
  })

  it('does not dispatch when another replica holds the head of the queue', async () => {
    db.claimQueuedMessage.mockResolvedValueOnce(null)
    const start = vi.fn()
    await drainSessionMessageQueue('ws', 's1', start)
    expect(start).not.toHaveBeenCalled()
    expect(db.finishQueuedMessage).not.toHaveBeenCalled()
  })

  it('retains messages on setup failure and renews the delivery lease during cold start', async () => {
    let reject!: (error: Error) => void
    const start = vi.fn(
      () =>
        new Promise<Response>((_, r) => {
          reject = r
        }),
    )
    const pending = drainSessionMessageQueue('ws', 's1', start)
    await vi.advanceTimersByTimeAsync(40_001)
    expect(db.renewQueuedMessage).toHaveBeenCalledTimes(2)
    reject(new Error('agent unavailable'))
    await pending
    expect(db.finishQueuedMessage).toHaveBeenLastCalledWith('1', expect.any(String), false)
    await vi.advanceTimersByTimeAsync(40_000)
    expect(db.renewQueuedMessage).toHaveBeenCalledTimes(2)
  })

  it('sweeps durable entries at startup and after a missed turn-end wakeup', async () => {
    db.listQueuedSessions.mockResolvedValue([{ id: 's1', workspace_id: 'ws' }])
    const start = vi.fn().mockResolvedValue(new Response('{}', { status: 409 }))
    startSessionMessageQueue(start)
    await vi.advanceTimersByTimeAsync(0)
    expect(start).toHaveBeenCalledTimes(1)
    start.mockResolvedValue(
      new Response('data: {}\n\n', { headers: { 'Content-Type': 'text/event-stream' } }),
    )
    await vi.advanceTimersByTimeAsync(5_000)
    expect(start).toHaveBeenCalledTimes(2)
    expect(db.finishQueuedMessage).toHaveBeenLastCalledWith('1', expect.any(String), true)
  })
})
