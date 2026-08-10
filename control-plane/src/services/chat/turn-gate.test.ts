import { beforeEach, describe, expect, it } from 'vitest'

// Set the bounds before the gate module reads them. Top-level await import so
// they're in place first. Capacity itself is seeded through the router, not an
// env constant.
process.env.TURN_GATE_MAX_QUEUE = '2'
process.env.TURN_GATE_MAX_WAIT_MS = '50'

const { acquireTurn, drainAll, TurnCapacityError, __resetTurnGate } = await import('./turn-gate')
const { syncReadyReplicas, __resetReplicaRouter } = await import('../replica-router')

// The gate reads capacity from the replica router: readyReplicas × the
// workspace's per-replica capacity (max_concurrency). One rule for every
// workspace — a running static one reports a single ready replica, so it lands
// on the same arithmetic with replicas = 1.
const ready = (workspaceId: string, replicas: number, perReplicaCapacity = 1) =>
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

describe('acquireTurn — a workspace cp has not observed', () => {
  // No reported ready set means cp cannot size a cap, so it does not impose one:
  // a workspace mid-start must not have its first turns rejected.
  it('admits without limit while no replica set is known', async () => {
    const slots = await Promise.all(Array.from({ length: 8 }, () => acquireTurn('unobserved-ws')))

    expect(slots).toHaveLength(8)
    for (const s of slots) s.release()
  })
})

describe('acquireTurn — capacity', () => {
  // The static shape is not exempt: one ready replica × max_concurrency is its
  // cap, the same arithmetic an auto-scaling workspace gets.
  it('caps a single-replica workspace at its per-replica capacity', async () => {
    ready('ws1', 1, 2) // capacity = 1 × 2

    const a = await acquireTurn('ws1')
    const b = await acquireTurn('ws1')
    let thirdGranted = false
    void acquireTurn('ws1')
      .then(() => {
        thirdGranted = true
      })
      .catch(() => {})
    await tick()

    expect(thirdGranted).toBe(false)
    a.release()
    b.release()
  })

  it('admits up to capacity, then queues until a slot frees', async () => {
    ready('ws1', 1) // capacity = 1 × target(1) = 1
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
    ready('ws1', 2) // capacity = 2
    const a = await acquireTurn('ws1')
    const b = await acquireTurn('ws1')
    expect(a).toBeDefined()
    expect(b).toBeDefined()
    a.release()
    b.release()
  })

  it('a queued turn waits, and is granted when a slot frees', async () => {
    ready('ws1', 1)
    const held = await acquireTurn('ws1') // active, capacity 1

    let granted = false
    const queued = acquireTurn('ws1').then((s) => {
      granted = true
      return s
    })
    await tick(20)
    expect(granted).toBe(false)

    held.release()
    await expect(queued).resolves.toBeDefined()
  })

  // A workspace whose capacity cannot grow has nothing to wait for beyond its own
  // turns finishing, so a stuck turn must not freeze its callers indefinitely.
  it('gives up on a turn that has waited past the limit', async () => {
    ready('ws1', 1)
    await acquireTurn('ws1') // held, never released

    await expect(acquireTurn('ws1')).rejects.toBeInstanceOf(TurnCapacityError)
  })

  it('frees the queue slot a timed-out turn held', async () => {
    ready('ws1', 1)
    await acquireTurn('ws1')
    await expect(acquireTurn('ws1')).rejects.toBeInstanceOf(TurnCapacityError)
    await expect(acquireTurn('ws1')).rejects.toBeInstanceOf(TurnCapacityError)

    // Both waiters left the queue on timeout, so a fresh arrival still queues
    // rather than hitting the depth bound.
    let rejected = false
    void acquireTurn('ws1').catch(() => {
      rejected = true
    })
    await tick()

    expect(rejected).toBe(false)
  })

  it('rejects with TurnCapacityError once the queue is full (flood backstop)', async () => {
    ready('ws1', 1) // cap 1, queue max 2
    await acquireTurn('ws1') // active
    acquireTurn('ws1').catch(() => {}) // queued 1
    acquireTurn('ws1').catch(() => {}) // queued 2 (full)
    await expect(acquireTurn('ws1')).rejects.toBeInstanceOf(TurnCapacityError)
  })

  it('release is idempotent — a double release frees only one slot', async () => {
    ready('ws1', 1)
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

describe('drainAll', () => {
  // Scale-up grows the cap without releasing any slot, so nothing would notice
  // the new room without an explicit re-check after the router refresh.
  it('grants waiting turns once a refresh reveals more capacity', async () => {
    ready('ws1', 1)
    const held = await acquireTurn('ws1')

    let granted = false
    const queued = acquireTurn('ws1').then((s) => {
      granted = true
      return s
    })
    await tick()
    expect(granted).toBe(false)

    ready('ws1', 2) // a second replica became ready
    drainAll()

    await expect(queued).resolves.toBeDefined()
    held.release()
  })
})
