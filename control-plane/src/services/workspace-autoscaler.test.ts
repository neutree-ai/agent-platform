import { describe, expect, it } from 'vitest'
import { desiredReplicas } from './workspace-autoscaler'

// desiredReplicas is the autoscaler's pure core: (active + queued) turns carried
// at perReplicaCapacity each, clamped to [min, max].

const at = (active: number, queued = 0) => ({ active, queued })

describe('desiredReplicas', () => {
  it('sizes to cover active + queued turns at capacity each', () => {
    expect(desiredReplicas(at(6), { perReplicaCapacity: 3, min: 0, max: 10 })).toBe(2)
    expect(desiredReplicas(at(7), { perReplicaCapacity: 3, min: 0, max: 10 })).toBe(3) // ceil
    expect(desiredReplicas(at(3, 4), { perReplicaCapacity: 3, min: 0, max: 10 })).toBe(3) // 7/3
  })

  it('holds the min floor when demand is low (incl. zero)', () => {
    expect(desiredReplicas(at(0), { perReplicaCapacity: 3, min: 2, max: 10 })).toBe(2)
    expect(desiredReplicas(at(1), { perReplicaCapacity: 3, min: 2, max: 10 })).toBe(2)
  })

  it('caps at max under heavy demand', () => {
    expect(desiredReplicas(at(100), { perReplicaCapacity: 3, min: 1, max: 4 })).toBe(4)
  })

  it('allows zero when min is zero and there is no demand (scale-to-zero target)', () => {
    expect(desiredReplicas(at(0), { perReplicaCapacity: 3, min: 0, max: 10 })).toBe(0)
  })

  it('never divides by zero on a bad capacity', () => {
    expect(desiredReplicas(at(4), { perReplicaCapacity: 0, min: 0, max: 10 })).toBe(4)
  })
})
