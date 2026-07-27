import { describe, expect, it } from 'vitest'
import {
  EMPTY_SESSION_FILTER,
  activeFacetCount,
  normalizeSessionFilter,
  normalizeStatuses,
  timeWindowStart,
} from './session-filter'

describe('activeFacetCount', () => {
  it('is zero for the default filter', () => {
    expect(activeFacetCount(EMPTY_SESSION_FILTER)).toBe(0)
  })

  it('counts facets, not selections within a facet', () => {
    expect(
      activeFacetCount({
        ...EMPTY_SESSION_FILTER,
        excludedSources: ['schedule', 'webhook'],
      }),
    ).toBe(1)
  })

  it('adds up across facets', () => {
    expect(
      activeFacetCount({
        excludedSources: ['schedule'],
        statuses: ['human'],
        time: '7d',
        starredOnly: true,
      }),
    ).toBe(4)
  })
})

describe('normalizeStatuses', () => {
  it('collapses a full selection to "no filter"', () => {
    expect(normalizeStatuses(['human', 'agent', 'idle'])).toEqual([])
  })

  it('keeps a partial selection', () => {
    expect(normalizeStatuses(['human'])).toEqual(['human'])
  })
})

describe('timeWindowStart', () => {
  // Local-time constructors: the window is snapped to the *viewer's* day, so
  // fixing an instant in UTC would make these assertions timezone-dependent.
  const now = new Date(2026, 6, 27, 9, 30)

  it('has no lower bound for "any"', () => {
    expect(timeWindowStart('any', now)).toBeUndefined()
  })

  it('snaps to a local day boundary so the react-query key is stable', () => {
    const today = timeWindowStart('today', now)
    const laterSameDay = timeWindowStart('today', new Date(2026, 6, 27, 23, 59))
    expect(today).toBe(laterSameDay)
    expect(new Date(today!).getHours()).toBe(0)
  })

  it('counts the window inclusive of today', () => {
    const start = new Date(timeWindowStart('7d', now)!)
    const today = new Date(now)
    today.setHours(0, 0, 0, 0)
    const days = Math.round((today.getTime() - start.getTime()) / 86_400_000)
    expect(days).toBe(6)
  })
})

describe('normalizeSessionFilter', () => {
  it('reads a missing or partial stored value as "not filtering"', () => {
    expect(normalizeSessionFilter(undefined)).toEqual(EMPTY_SESSION_FILTER)
    expect(normalizeSessionFilter({ starredOnly: true })).toEqual({
      ...EMPTY_SESSION_FILTER,
      starredOnly: true,
    })
  })

  it('drops values this build no longer knows', () => {
    const filter = normalizeSessionFilter({
      statuses: ['human', 'retired-bucket'] as never,
      time: 'last-quarter' as never,
    })
    expect(filter.statuses).toEqual(['human'])
    expect(filter.time).toBe('any')
  })
})
