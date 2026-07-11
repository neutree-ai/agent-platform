/**
 * Unit tests for the refresh-failure grace decision — the core of the fix that
 * stops a transient upstream `invalid_grant` (a TLS blip while the MCP broker
 * refreshes the provider token) from deleting the stored OAuth token on the
 * first failure and forcing the user to re-authorize.
 *
 * Only the pure decision function is exercised here; the DB-backed counter
 * (`recordRefreshFailure`) and reset (`upsertToken`) hit the global pool and
 * are out of scope for a unit test.
 */
import { describe, expect, it } from 'vitest'
import { classifyTokenLife, shouldDropTokenOnRefreshFailure } from './mcp-oauth'

const NOW = new Date('2026-06-10T12:00:00.000Z')
const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000)

describe('shouldDropTokenOnRefreshFailure', () => {
  it('never drops when there is no recorded failure streak', () => {
    expect(shouldDropTokenOnRefreshFailure(0, null, NOW)).toBe(false)
  })

  it('holds the token on the first failure (a likely transient blip)', () => {
    expect(shouldDropTokenOnRefreshFailure(1, NOW, NOW)).toBe(false)
  })

  it('holds the token while failures are still within the grace window', () => {
    // Many failures, but they all started < 10min ago — still treat as transient.
    expect(shouldDropTokenOnRefreshFailure(50, ago(120), NOW)).toBe(false)
  })

  it('holds the token past the window if the failure count is still low', () => {
    // Old enough, but only one failure: not yet a persistent dead-token signal.
    expect(shouldDropTokenOnRefreshFailure(1, ago(3600), NOW)).toBe(false)
  })

  it('drops the token once failures persist past the window and count threshold', () => {
    expect(shouldDropTokenOnRefreshFailure(3, ago(601), NOW)).toBe(true)
    expect(shouldDropTokenOnRefreshFailure(10, ago(7200), NOW)).toBe(true)
  })

  it('is exactly at the grace boundary (inclusive)', () => {
    expect(shouldDropTokenOnRefreshFailure(3, ago(600), NOW)).toBe(true)
    expect(shouldDropTokenOnRefreshFailure(3, ago(599), NOW)).toBe(false)
  })
})

describe('classifyTokenLife', () => {
  const MINUTE = 60 * 1000

  it('serves a token with plenty of life as-is', () => {
    expect(classifyTokenLife(30 * MINUTE)).toBe('fresh')
  })

  it('flags a token inside the pre-expiry margin for proactive refresh', () => {
    // google-auth clients treat a token as expired 3m45s before the wire
    // expiry; the margin must catch it before that.
    expect(classifyTokenLife(4 * MINUTE)).toBe('refresh-ahead')
    expect(classifyTokenLife(1)).toBe('refresh-ahead')
  })

  it('is exactly at the margin boundary (exclusive)', () => {
    expect(classifyTokenLife(5 * MINUTE + 1)).toBe('fresh')
    expect(classifyTokenLife(5 * MINUTE)).toBe('refresh-ahead')
  })

  it('reports a past-expiry token as expired', () => {
    expect(classifyTokenLife(0)).toBe('expired')
    expect(classifyTokenLife(-1)).toBe('expired')
  })
})
