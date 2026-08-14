import { describe, expect, it } from 'vitest'
import { type RuntimeSegment, mergeSegments } from './resource-usage'

function segment(over: Partial<RuntimeSegment> = {}): RuntimeSegment {
  return {
    startedAt: '2026-08-11T00:00:00.000Z',
    endedAt: '2026-08-11T01:00:00.000Z',
    phase: 'running',
    replicas: 1,
    coreRequest: 1,
    storageGib: 50,
    specVersion: 11,
    ...over,
  }
}

describe('mergeSegments', () => {
  it('joins adjacent segments that describe the same state', () => {
    // The meter logs a row when a replica count first becomes known, which
    // splits one unbroken run into two rows saying the same thing.
    const merged = mergeSegments([
      segment({ startedAt: '2026-08-11T00:00:00.000Z', endedAt: '2026-08-11T01:00:00.000Z' }),
      segment({ startedAt: '2026-08-11T01:00:00.000Z', endedAt: '2026-08-11T05:00:00.000Z' }),
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0].startedAt).toBe('2026-08-11T00:00:00.000Z')
    expect(merged[0].endedAt).toBe('2026-08-11T05:00:00.000Z')
  })

  it('keeps a real state change apart', () => {
    const merged = mergeSegments([segment(), segment({ phase: 'stopped', replicas: 0 })])
    expect(merged.map((s) => s.phase)).toEqual(['running', 'stopped'])
  })

  it('keeps a resize apart even while the phase holds', () => {
    const merged = mergeSegments([segment(), segment({ coreRequest: 4, specVersion: 12 })])
    expect(merged).toHaveLength(2)
  })

  it('does not mutate the segments it was given', () => {
    const first = segment()
    mergeSegments([first, segment({ endedAt: '2026-08-11T09:00:00.000Z' })])
    expect(first.endedAt).toBe('2026-08-11T01:00:00.000Z')
  })

  it('returns nothing for a workspace with no history', () => {
    expect(mergeSegments([])).toEqual([])
  })
})
