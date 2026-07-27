import { describe, expect, it } from 'vitest'
import { sortSources, sourceLabel, sourceVisual } from './session-source'

// Stand-in for i18next's `t`: returns the last key segment so assertions read
// as the label key that would have been looked up.
const t = (key: string) => key.split('.').pop() ?? key

describe('sourceVisual', () => {
  it('gives every known source its own label key', () => {
    const known = [
      'web',
      'schedule',
      'slack',
      'wecom',
      'webhook',
      'agent',
      'api',
      'batch',
      'teamwork',
    ]
    const keys = known.map((s) => sourceVisual(s).labelKey)
    expect(new Set(keys).size).toBe(known.length)
  })

  it('does not fold an unknown source into the manual label', () => {
    // Two sources rendering under the same name are indistinguishable in the
    // filter menu — the bug this guards.
    expect(sourceVisual('some-future-connector').labelKey).toBeNull()
    expect(sourceLabel('some-future-connector', t)).toBe('some-future-connector')
    expect(sourceLabel('web', t)).toBe('web')
  })
})

describe('sortSources', () => {
  it('sorts known sources into a fixed order', () => {
    expect(sortSources(['agent', 'web', 'slack'])).toEqual(['web', 'slack', 'agent'])
  })

  it('puts unknown sources last rather than dropping them', () => {
    expect(sortSources(['zzz-new', 'web'])).toEqual(['web', 'zzz-new'])
  })
})
