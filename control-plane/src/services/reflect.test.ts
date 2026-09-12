import { describe, expect, it } from 'vitest'
import { reflectWindow } from './reflect'

// reflectWindow is the one formula that decides both what a Reflect turn is
// allowed to look at (list_recent_activity) and what its checkpoint advances
// to afterward (reflect/end) — the two call sites must derive byte-identical
// bounds from the same inputs with zero state threaded between them, so this
// is worth pinning down precisely.

const DAY_MS = 24 * 60 * 60 * 1000
const CHUNK_MS = 7 * DAY_MS

describe('reflectWindow', () => {
  it('starts from created_at on a store that has never been reflected on', () => {
    const createdAt = '2026-01-01T00:00:00.000Z'
    const turnCreatedAt = '2026-01-02T00:00:00.000Z' // 1 day later, well within the chunk
    const { since, until } = reflectWindow(
      { last_reflected_at: null, created_at: createdAt },
      turnCreatedAt,
    )
    expect(since).toBe(createdAt)
    // Caught all the way up to "now" since the gap is smaller than one chunk.
    expect(until).toBe(turnCreatedAt)
  })

  it('starts from last_reflected_at once the store has a checkpoint', () => {
    const lastReflectedAt = '2026-01-10T00:00:00.000Z'
    const turnCreatedAt = '2026-01-10T12:00:00.000Z'
    const { since, until } = reflectWindow(
      { last_reflected_at: lastReflectedAt, created_at: '2020-01-01T00:00:00.000Z' },
      turnCreatedAt,
    )
    expect(since).toBe(lastReflectedAt)
    expect(until).toBe(turnCreatedAt)
  })

  it('caps a single turn to one chunk when the checkpoint is far behind, instead of jumping to now', () => {
    const lastReflectedAt = '2026-01-01T00:00:00.000Z'
    // 30 days of backlog -- far more than one 7-day chunk.
    const turnCreatedAt = '2026-01-31T00:00:00.000Z'
    const { since, until } = reflectWindow(
      { last_reflected_at: lastReflectedAt, created_at: '2020-01-01T00:00:00.000Z' },
      turnCreatedAt,
    )
    expect(since).toBe(lastReflectedAt)
    expect(new Date(until).getTime()).toBe(new Date(lastReflectedAt).getTime() + CHUNK_MS)
    // Left with backlog beyond `until` -- the next scheduled run picks up from here.
    expect(new Date(until).getTime()).toBeLessThan(new Date(turnCreatedAt).getTime())
  })

  it('never advances past turnCreatedAt even when a full chunk would overshoot it', () => {
    const lastReflectedAt = '2026-01-01T00:00:00.000Z'
    // Less than a full chunk of backlog.
    const turnCreatedAt = '2026-01-03T00:00:00.000Z'
    const { until } = reflectWindow(
      { last_reflected_at: lastReflectedAt, created_at: '2020-01-01T00:00:00.000Z' },
      turnCreatedAt,
    )
    expect(new Date(until).getTime()).toBeLessThanOrEqual(new Date(turnCreatedAt).getTime())
    expect(until).toBe(turnCreatedAt)
  })

  it('produces an empty window (since === until) when already fully caught up', () => {
    const lastReflectedAt = '2026-01-05T00:00:00.000Z'
    const { since, until } = reflectWindow(
      { last_reflected_at: lastReflectedAt, created_at: '2020-01-01T00:00:00.000Z' },
      lastReflectedAt,
    )
    expect(since).toBe(until)
  })
})
