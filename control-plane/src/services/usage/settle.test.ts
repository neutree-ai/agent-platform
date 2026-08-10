import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTLE_GRACE_MS } from '../../../../internal/agent-usage/src/index'
import type { SessionSettlementFacts } from '../db/workspace-usage'
import { evaluateSettlement } from './settle'

const ACTIVITY = '2026-08-10T06:40:44.000Z'

/** A drain that happened `ms` after the session's last activity. */
function drainedAfter(ms: number): string {
  return new Date(Date.parse(ACTIVITY) + ms).toISOString()
}

function facts(over: Partial<SessionSettlementFacts> = {}): SessionSettlementFacts {
  return {
    activity_at: ACTIVITY,
    drained_through: drainedAfter(DEFAULT_SETTLE_GRACE_MS + 1_000),
    chat_status: 'human',
    ...over,
  }
}

describe('evaluateSettlement', () => {
  it('settles once a drain clears the activity by more than the settle grace', () => {
    expect(evaluateSettlement(facts(), 'drained')).toMatchObject({
      complete: true,
      reason: null,
    })
  })

  it('withholds a drain that landed inside the grace', () => {
    // The parser holds back a file's trailing entry until it has been quiescent
    // for the grace, so this drain cannot have seen the session's last record.
    const inside = facts({ drained_through: drainedAfter(DEFAULT_SETTLE_GRACE_MS - 1_000) })
    expect(evaluateSettlement(inside, 'drained')).toMatchObject({
      complete: false,
      reason: 'pending_settle',
    })
  })

  it('withholds a drain that predates the activity', () => {
    const before = facts({ drained_through: drainedAfter(-60_000) })
    expect(evaluateSettlement(before, 'drained').complete).toBe(false)
  })

  it('never settles while a turn is running, however old the drain', () => {
    const running = facts({
      chat_status: 'agent',
      drained_through: drainedAfter(3_600_000),
    })
    expect(evaluateSettlement(running, 'drained')).toMatchObject({
      complete: false,
      reason: 'turn_in_progress',
    })
  })

  it('reports a running turn ahead of a failed pull', () => {
    const running = facts({ chat_status: 'agent' })
    expect(evaluateSettlement(running, 'agent_unreachable').reason).toBe('turn_in_progress')
  })

  it('does not settle a workspace that was never drained', () => {
    expect(evaluateSettlement(facts({ drained_through: null }), null)).toMatchObject({
      complete: false,
      reason: 'pending_settle',
    })
  })

  it('settles an empty session once the workspace has been drained', () => {
    // Nothing to account for, and a drain proved the agent had nothing to give.
    expect(evaluateSettlement(facts({ activity_at: null }), 'drained')).toMatchObject({
      complete: true,
      reason: null,
    })
  })

  it('does not settle an empty session before any drain', () => {
    expect(
      evaluateSettlement(facts({ activity_at: null, drained_through: null }), null).complete,
    ).toBe(false)
  })

  it.each([
    ['agent_unreachable', 'agent_unreachable'],
    ['agent_error', 'agent_unreachable'],
    ['workspace_gone', 'workspace_gone'],
    // A capped drain made real progress; it just has more to read.
    ['batch_cap', 'pending_settle'],
  ] as const)('maps a %s stop to reason %s', (stop, reason) => {
    const stale = facts({ drained_through: drainedAfter(-60_000) })
    expect(evaluateSettlement(stale, stop).reason).toBe(reason)
  })

  it('echoes the facts the verdict was drawn from', () => {
    const f = facts()
    expect(evaluateSettlement(f, 'drained')).toMatchObject({
      drained_through: f.drained_through,
      activity_at: f.activity_at,
    })
  })
})
