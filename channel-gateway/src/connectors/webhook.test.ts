import { describe, expect, it } from 'vitest'
import { matchFilters } from './webhook'

const baseCtx = { query: {}, headers: {}, method: 'POST', path: '/hook' }

describe('matchFilters — array_contains', () => {
  const labels = [
    { id: 1, title: 'bug', color: '#f00' },
    { id: 2, title: 'zh-review', color: '#0f0' },
  ]

  it('matches when an array element has the target itemField value', () => {
    const ctx = { ...baseCtx, body: { labels } }
    const filters = [
      {
        field: 'body.labels',
        op: 'array_contains' as const,
        itemField: 'title',
        value: 'zh-review',
      },
    ]

    expect(matchFilters(filters, ctx)).toBe(true)
  })

  it('does not match when no element has the target itemField value', () => {
    const ctx = { ...baseCtx, body: { labels } }
    const filters = [
      {
        field: 'body.labels',
        op: 'array_contains' as const,
        itemField: 'title',
        value: 'needs-triage',
      },
    ]

    expect(matchFilters(filters, ctx)).toBe(false)
  })

  it('matches primitive array elements directly when itemField is omitted', () => {
    const ctx = { ...baseCtx, body: { tags: ['a', 'b', 'c'] } }
    const filters = [{ field: 'body.tags', op: 'array_contains' as const, value: 'b' }]

    expect(matchFilters(filters, ctx)).toBe(true)
  })

  it('does not match when the field resolves to a non-array', () => {
    const ctx = { ...baseCtx, body: { labels: 'not-an-array' } }
    const filters = [
      {
        field: 'body.labels',
        op: 'array_contains' as const,
        itemField: 'title',
        value: 'zh-review',
      },
    ]

    expect(matchFilters(filters, ctx)).toBe(false)
  })

  it('is unaffected by element order', () => {
    const ctx = { ...baseCtx, body: { labels: [...labels].reverse() } }
    const filters = [
      {
        field: 'body.labels',
        op: 'array_contains' as const,
        itemField: 'title',
        value: 'zh-review',
      },
    ]

    expect(matchFilters(filters, ctx)).toBe(true)
  })
})
