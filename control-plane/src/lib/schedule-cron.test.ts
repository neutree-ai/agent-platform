import { describe, expect, it } from 'vitest'
import {
  ScheduleCreateBodySchema,
  ScheduleUpdateBodySchema,
  hasOutOfRangeCronStep,
} from '../../../internal/types/api'

// cron-parser silently collapses a step larger than a field's range instead
// of erroring — e.g. "0/120" in the minute field only ever matches minute 0,
// turning "every 120 minutes" into "every hour" with no error. Both the web
// preview and pg-boss (real schedule execution) run on that same library, so
// this has to be rejected before it reaches either.
describe('hasOutOfRangeCronStep', () => {
  it('flags a minute step beyond 59 (the reported bug)', () => {
    expect(hasOutOfRangeCronStep('0/120 * * * *')).toBe(true)
  })

  it('flags an hour step beyond 23', () => {
    expect(hasOutOfRangeCronStep('0 0/25 * * *')).toBe(true)
  })

  it('flags a day-of-month step beyond 31', () => {
    expect(hasOutOfRangeCronStep('0 9 1/40 * *')).toBe(true)
  })

  it('flags a month step beyond 12', () => {
    expect(hasOutOfRangeCronStep('0 9 1 1/15 *')).toBe(true)
  })

  it('flags a day-of-week step beyond 7', () => {
    expect(hasOutOfRangeCronStep('0 9 * * 1/10')).toBe(true)
  })

  it('allows an in-range minute step', () => {
    expect(hasOutOfRangeCronStep('*/30 * * * *')).toBe(false)
  })

  it('allows the hour-field equivalent of "every 120 minutes"', () => {
    expect(hasOutOfRangeCronStep('0 */2 * * *')).toBe(false)
  })

  it('allows plain fixed-time expressions with no step syntax', () => {
    expect(hasOutOfRangeCronStep('0 9 * * *')).toBe(false)
  })

  it('does not throw on a malformed expression — returns false so existing invalid-expression handling still applies', () => {
    expect(hasOutOfRangeCronStep('not a cron')).toBe(false)
    expect(hasOutOfRangeCronStep('')).toBe(false)
  })
})

describe('ScheduleCreateBodySchema cron step validation', () => {
  const base = { name: 'test', prompt: 'hi' }

  it('rejects a cron with an out-of-range step', () => {
    const result = ScheduleCreateBodySchema.safeParse({ ...base, cron: '0/120 * * * *' })
    expect(result.success).toBe(false)
  })

  it('accepts a cron with a valid step', () => {
    const result = ScheduleCreateBodySchema.safeParse({ ...base, cron: '0 */2 * * *' })
    expect(result.success).toBe(true)
  })

  it('still rejects when both cron and run_at are set, independent of step validity', () => {
    const result = ScheduleCreateBodySchema.safeParse({
      ...base,
      cron: '0 9 * * *',
      run_at: '2099-01-01T00:00:00.000Z',
    })
    expect(result.success).toBe(false)
  })
})

describe('ScheduleUpdateBodySchema cron step validation', () => {
  it('rejects a cron with an out-of-range step', () => {
    const result = ScheduleUpdateBodySchema.safeParse({ cron: '0/120 * * * *' })
    expect(result.success).toBe(false)
  })

  it('accepts a partial update without touching cron', () => {
    const result = ScheduleUpdateBodySchema.safeParse({ enabled: false })
    expect(result.success).toBe(true)
  })

  it('accepts clearing cron to null (switching to a one-time schedule)', () => {
    const result = ScheduleUpdateBodySchema.safeParse({
      cron: null,
      run_at: '2099-01-01T00:00:00.000Z',
    })
    expect(result.success).toBe(true)
  })
})
