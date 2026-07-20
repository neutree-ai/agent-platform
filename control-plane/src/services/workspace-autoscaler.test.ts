import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./db/pool', () => ({ pool: { query: vi.fn() } }))
vi.mock('./chat/turn-gate', () => ({ turnDemand: vi.fn() }))
vi.mock('./replica-router', () => ({ readyReplicaIds: vi.fn(), setDraining: vi.fn() }))
vi.mock('./db/sessions', () => ({ replicasHaveActiveTurn: vi.fn() }))
vi.mock('./placement', () => ({ setDesiredReplicas: vi.fn(), setDesiredPhase: vi.fn() }))

import { turnDemand } from './chat/turn-gate'
import { pool } from './db/pool'
import { replicasHaveActiveTurn } from './db/sessions'
import { setDesiredPhase, setDesiredReplicas } from './placement'
import { readyReplicaIds, setDraining } from './replica-router'
import {
  __resetAutoscaler,
  desiredReplicas,
  replicasToRemove,
  runAutoscaler,
} from './workspace-autoscaler'

const q = vi.mocked(pool.query)
const demand = vi.mocked(turnDemand)
const ready = vi.mocked(readyReplicaIds)
const draining = vi.mocked(setDraining)
const activeTurn = vi.mocked(replicasHaveActiveTurn)
const setReplicas = vi.mocked(setDesiredReplicas)
const setPhase = vi.mocked(setDesiredPhase)

const WS = 'ws1'
type Row = {
  min_replicas: number
  max_replicas: number
  scale_to_zero_idle_seconds: number | null
  max_concurrency: number
  current_replicas: number
}
const defaults: Row = {
  min_replicas: 1,
  max_replicas: 10,
  scale_to_zero_idle_seconds: null,
  max_concurrency: 3,
  current_replicas: 3,
}

/** Arrange one running auto-scaling workspace for the next runAutoscaler pass. */
function arrange(
  row: Partial<Row>,
  d: { active: number; queued: number },
  opts: { ready?: number[]; hasTurn?: boolean } = {},
) {
  q.mockResolvedValue({ rows: [{ workspace_id: WS, ...defaults, ...row }] } as never)
  demand.mockReturnValue(d)
  ready.mockReturnValue(opts.ready ?? [0, 1, 2])
  activeTurn.mockResolvedValue(opts.hasTurn ?? false)
}

beforeEach(() => {
  vi.clearAllMocks()
  __resetAutoscaler()
  vi.useFakeTimers()
  vi.setSystemTime(0)
})
afterEach(() => vi.useRealTimers())

describe('replicasToRemove', () => {
  it('removes the highest ordinals (>= desired), sorted', () => {
    expect(replicasToRemove([0, 1, 2], 2)).toEqual([2])
    expect(replicasToRemove([0, 1, 2, 3], 2)).toEqual([2, 3])
    expect(replicasToRemove([2, 0, 1], 1)).toEqual([1, 2])
  })
  it('removes nothing when the ready set is already at/below desired', () => {
    expect(replicasToRemove([0, 1], 2)).toEqual([])
    expect(replicasToRemove([], 0)).toEqual([])
  })
})

describe('desiredReplicas', () => {
  it('sizes to (active+queued)/capacity, clamped to [min,max]', () => {
    expect(
      desiredReplicas({ active: 7, queued: 0 }, { perReplicaCapacity: 3, min: 0, max: 10 }),
    ).toBe(3)
    expect(
      desiredReplicas({ active: 0, queued: 0 }, { perReplicaCapacity: 3, min: 0, max: 10 }),
    ).toBe(0)
  })
})

describe('runAutoscaler scale-up', () => {
  it('raises desired to meet demand immediately', async () => {
    arrange({ current_replicas: 1 }, { active: 6, queued: 0 })
    await runAutoscaler()
    expect(setReplicas).toHaveBeenCalledWith(WS, 2)
    expect(draining).toHaveBeenCalledWith(WS, [])
  })
})

describe('runAutoscaler scale-down', () => {
  it('waits SCALE_DOWN_ROUNDS low rounds before removing a replica', async () => {
    // current 3, demand fits 1 replica → target 1 < 3.
    arrange({ current_replicas: 3 }, { active: 3, queued: 0 })
    await runAutoscaler()
    await runAutoscaler()
    expect(setReplicas).not.toHaveBeenCalled()
    await runAutoscaler() // 3rd low round
    expect(setReplicas).toHaveBeenCalledWith(WS, 2)
    expect(draining).toHaveBeenLastCalledWith(WS, [2]) // highest ordinal drained
  })

  it('holds the step while the draining replica still has an in-flight turn', async () => {
    arrange({ current_replicas: 3 }, { active: 3, queued: 0 }, { hasTurn: true })
    await runAutoscaler()
    await runAutoscaler()
    await runAutoscaler()
    expect(draining).toHaveBeenLastCalledWith(WS, [2]) // marked draining
    expect(setReplicas).not.toHaveBeenCalled() // but not removed — turn in flight
  })

  it('cancels a pending scale-down when demand climbs back to the current count', async () => {
    arrange({ current_replicas: 3 }, { active: 3, queued: 0 })
    await runAutoscaler() // low round 1
    // demand rises to exactly fit 3 replicas (cap 3 → 9) — steady
    demand.mockReturnValue({ active: 9, queued: 0 })
    await runAutoscaler()
    demand.mockReturnValue({ active: 3, queued: 0 })
    await runAutoscaler() // counter was reset → only low round 1 again
    expect(setReplicas).not.toHaveBeenCalled()
  })
})

describe('runAutoscaler scale-to-zero', () => {
  it('stops a workspace idle past its threshold, on a later pass', async () => {
    arrange({ current_replicas: 2, scale_to_zero_idle_seconds: 300 }, { active: 0, queued: 0 })
    await runAutoscaler() // t=0: idle clock starts
    expect(setPhase).not.toHaveBeenCalled()
    vi.setSystemTime(301_000)
    await runAutoscaler()
    expect(setPhase).toHaveBeenCalledWith(WS, 'stopped')
  })

  it('never stops when scale-to-zero is disabled', async () => {
    arrange({ current_replicas: 2, scale_to_zero_idle_seconds: null }, { active: 0, queued: 0 })
    await runAutoscaler()
    vi.setSystemTime(10_000_000)
    await runAutoscaler()
    expect(setPhase).not.toHaveBeenCalled()
  })

  it('resets the idle clock when demand reappears', async () => {
    arrange({ current_replicas: 2, scale_to_zero_idle_seconds: 300 }, { active: 0, queued: 0 })
    await runAutoscaler() // idle clock starts at t=0
    demand.mockReturnValue({ active: 1, queued: 0 }) // busy again
    vi.setSystemTime(200_000)
    await runAutoscaler() // clock cleared
    demand.mockReturnValue({ active: 0, queued: 0 }) // idle again
    vi.setSystemTime(400_000)
    await runAutoscaler() // clock restarts here, < threshold since
    expect(setPhase).not.toHaveBeenCalled()
  })
})
