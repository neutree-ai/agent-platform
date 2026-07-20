import { beforeEach, describe, expect, it } from 'vitest'
import {
  __resetReplicaRouter,
  perReplicaCapacity,
  pickReplicaForTurn,
  readyReplicaIds,
  setDraining,
  syncReadyReplicas,
} from './replica-router'

// The replica router is pure in-memory state: a ready set fed by observation
// and a session→replica pick. It must be a no-op (undefined) for any workspace
// that has never reported replicas, so a static workspace routes to its default
// address exactly as before.

beforeEach(() => {
  __resetReplicaRouter()
})

const snapshot = (entries: Record<string, number[]>) =>
  new Map(Object.entries(entries).map(([ws, ids]) => [ws, { ids }]))

describe('pickReplicaForTurn', () => {
  it('returns undefined for a workspace with no reported replicas (static)', () => {
    expect(pickReplicaForTurn('ws1')).toBeUndefined()
    expect(pickReplicaForTurn('ws1', 0)).toBeUndefined()
  })

  it('picks a ready replica for a new session, round-robin across replicas', () => {
    syncReadyReplicas(snapshot({ ws1: [2, 0] })) // stored sorted → [0, 2]
    expect(pickReplicaForTurn('ws1')).toBe(0)
    expect(pickReplicaForTurn('ws1')).toBe(2)
    expect(pickReplicaForTurn('ws1')).toBe(0)
  })

  it('keeps an existing binding while its replica is still ready (affinity)', () => {
    syncReadyReplicas(snapshot({ ws1: [0, 1, 2] }))
    expect(pickReplicaForTurn('ws1', 2)).toBe(2)
    expect(pickReplicaForTurn('ws1', 2)).toBe(2)
  })

  it('rebinds to a fresh replica when the bound one dropped out of the ready set', () => {
    syncReadyReplicas(snapshot({ ws1: [0, 1] }))
    // replica 5 is gone (pod died / scaled away) → pick a healthy one
    expect(pickReplicaForTurn('ws1', 5)).toBe(0)
  })
})

describe('syncReadyReplicas', () => {
  it('fully replaces the picture — a workspace that stopped reporting falls back to default', () => {
    syncReadyReplicas(snapshot({ ws1: [0, 1] }))
    expect(pickReplicaForTurn('ws1')).toBe(0)

    syncReadyReplicas(snapshot({ ws2: [0] })) // ws1 no longer reported
    expect(pickReplicaForTurn('ws1')).toBeUndefined()
    expect(pickReplicaForTurn('ws2')).toBe(0)
  })

  it('treats an empty replica list as no auto-scaling replicas', () => {
    syncReadyReplicas(snapshot({ ws1: [] }))
    expect(pickReplicaForTurn('ws1')).toBeUndefined()
  })
})

describe('setDraining', () => {
  it('steers new picks away from a draining replica', () => {
    syncReadyReplicas(snapshot({ ws1: [0, 1, 2] }))
    setDraining('ws1', [2])
    // round-robin now spreads over the non-draining pool {0,1} only
    expect(pickReplicaForTurn('ws1')).toBe(0)
    expect(pickReplicaForTurn('ws1')).toBe(1)
    expect(pickReplicaForTurn('ws1')).toBe(0)
  })

  it('rebinds a session off a replica that started draining', () => {
    syncReadyReplicas(snapshot({ ws1: [0, 1, 2] }))
    expect(pickReplicaForTurn('ws1', 2)).toBe(2) // affinity holds while healthy
    setDraining('ws1', [2])
    expect(pickReplicaForTurn('ws1', 2)).not.toBe(2) // now moved off
  })

  it('falls back to the full set when every ready replica is draining', () => {
    syncReadyReplicas(snapshot({ ws1: [0, 1] }))
    setDraining('ws1', [0, 1])
    expect([0, 1]).toContain(pickReplicaForTurn('ws1'))
  })

  it('ignores drain targets that are not in the ready set, and clears on []', () => {
    syncReadyReplicas(snapshot({ ws1: [0, 1] }))
    setDraining('ws1', [9]) // stale ordinal → no effect
    expect(pickReplicaForTurn('ws1', 1)).toBe(1)
    setDraining('ws1', [1])
    expect(pickReplicaForTurn('ws1', 1)).not.toBe(1)
    setDraining('ws1', []) // clear
    expect(pickReplicaForTurn('ws1', 1)).toBe(1)
  })

  it('drops draining marks for replicas that leave the ready set on re-sync', () => {
    syncReadyReplicas(snapshot({ ws1: [0, 1, 2] }))
    setDraining('ws1', [2])
    syncReadyReplicas(snapshot({ ws1: [0, 1] })) // 2 removed
    // 2 is gone; a later 2 (unlikely, but) would not be treated as draining
    syncReadyReplicas(snapshot({ ws1: [0, 1, 2] }))
    expect(pickReplicaForTurn('ws1', 2)).toBe(2)
  })
})

describe('readyReplicaIds', () => {
  it('returns the sorted ready ids, empty for a static workspace', () => {
    expect(readyReplicaIds('static-ws')).toEqual([])
    syncReadyReplicas(snapshot({ ws1: [2, 0, 1] }))
    expect(readyReplicaIds('ws1')).toEqual([0, 1, 2])
  })
})

describe('perReplicaCapacity', () => {
  it('carries a workspace’s per-replica capacity from the snapshot', () => {
    syncReadyReplicas(new Map([['ws1', { ids: [0, 1], perReplicaCapacity: 10 }]]))
    expect(perReplicaCapacity('ws1')).toBe(10)
  })

  it('is undefined for an unknown workspace or one reported without a capacity', () => {
    expect(perReplicaCapacity('static-ws')).toBeUndefined()
    syncReadyReplicas(new Map([['ws1', { ids: [0] }]]))
    expect(perReplicaCapacity('ws1')).toBeUndefined()
  })
})
