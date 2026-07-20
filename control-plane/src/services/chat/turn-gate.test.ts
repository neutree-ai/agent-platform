import { beforeEach, describe, expect, it } from 'vitest'

// Set a tiny queue bound before the gate module reads it. Top-level await
// import so it's in place first. Capacity itself is seeded through the router,
// not an env constant.
process.env.TURN_GATE_MAX_QUEUE = '2'

const { acquireTurn, TurnCapacityError, __resetTurnGate } = await import('./turn-gate')
const { syncReadyReplicas, __resetReplicaRouter } = await import('../replica-router')

// The gate reads capacity from the replica router: a workspace with no ready
// replicas (static) is Infinity → never blocks; an auto-scaling one is
// readyReplicas × its per-replica capacity (max_concurrency). Seed both here so
// the tests exercise a real, known capacity with no gate-side constant.
const autoScaling = (workspaceId: string, replicas: number, perReplicaCapacity = 1) =>
  syncReadyReplicas(
    new Map([
      [workspaceId, { ids: Array.from({ length: replicas }, (_, i) => i), perReplicaCapacity }],
    ]),
  )

/** Resolve on the next macrotask so queued grants/timeouts can settle. */
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))

beforeEach(() => {
  __resetTurnGate()
  __resetReplicaRouter()
})

describe('acquireTurn — static workspace', () => {
  it('never blocks (accounts only): admits far past any single-pod count', async () => {
    const slots = await Promise.all(Array.from({ length: 8 }, () => acquireTurn('static-ws')))
    expect(slots).toHaveLength(8)
    for (const s of slots) s.release()
  })
})

describe('acquireTurn — auto-scaling workspace', () => {
  it('admits up to capacity, then queues until a slot frees', async () => {
    autoScaling('ws1', 1) // capacity = 1 × target(1) = 1
    const first = await acquireTurn('ws1')

    let secondGranted = false
    const second = acquireTurn('ws1').then((s) => {
      secondGranted = true
      return s
    })
    await tick()
    expect(secondGranted).toBe(false) // over capacity → queued

    first.release()
    await expect(second).resolves.toBeDefined()
    expect(secondGranted).toBe(true)
  })

  it('grows the cap with replica count (2 replicas → 2 concurrent)', async () => {
    autoScaling('ws1', 2) // capacity = 2
    const a = await acquireTurn('ws1')
    const b = await acquireTurn('ws1')
    expect(a).toBeDefined()
    expect(b).toBeDefined()
    a.release()
    b.release()
  })

  it('a queued turn waits (no timeout) — it resolves only when a slot frees', async () => {
    autoScaling('ws1', 1)
    const held = await acquireTurn('ws1') // active, capacity 1

    let granted = false
    const queued = acquireTurn('ws1').then((s) => {
      granted = true
      return s
    })
    await tick(20)
    expect(granted).toBe(false) // still waiting — no timeout kicks it out

    held.release()
    await expect(queued).resolves.toBeDefined() // freed → granted
  })

  it('rejects with TurnCapacityError once the queue is full (flood backstop)', async () => {
    autoScaling('ws1', 1) // cap 1, queue max 2
    await acquireTurn('ws1') // active
    acquireTurn('ws1').catch(() => {}) // queued 1
    acquireTurn('ws1').catch(() => {}) // queued 2 (full)
    await expect(acquireTurn('ws1')).rejects.toBeInstanceOf(TurnCapacityError)
  })

  it('release is idempotent — a double release frees only one slot', async () => {
    autoScaling('ws1', 1)
    const held = await acquireTurn('ws1')

    const q1 = acquireTurn('ws1')
    const q2 = acquireTurn('ws1')

    held.release()
    held.release() // no-op: must not free a second slot
    await expect(q1).resolves.toBeDefined()

    let q2Granted = false
    void q2
      .then(() => {
        q2Granted = true
      })
      .catch(() => {}) // reset() rejects it after the test; swallow
    await tick()
    expect(q2Granted).toBe(false) // still capped at 1
  })
})
