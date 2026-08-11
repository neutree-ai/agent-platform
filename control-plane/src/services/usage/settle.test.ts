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
    workspace_status: 'running',
    ...over,
  }
}

describe('evaluateSettlement', () => {
  it('settles once a drain clears the activity by more than the settle grace', () => {
    expect(evaluateSettlement(facts())).toMatchObject({
      complete: true,
      reason: null,
    })
  })

  it('withholds a drain that landed inside the grace', () => {
    // The parser holds back a file's trailing entry until it has been quiescent
    // for the grace, so this drain cannot have seen the session's last record.
    const inside = facts({ drained_through: drainedAfter(DEFAULT_SETTLE_GRACE_MS - 1_000) })
    expect(evaluateSettlement(inside)).toMatchObject({
      complete: false,
      reason: 'pending_settle',
    })
  })

  it('withholds a drain that predates the activity', () => {
    const before = facts({ drained_through: drainedAfter(-60_000) })
    expect(evaluateSettlement(before).complete).toBe(false)
  })

  it('never settles while a turn is running, however old the drain', () => {
    const running = facts({
      chat_status: 'agent',
      drained_through: drainedAfter(3_600_000),
    })
    expect(evaluateSettlement(running)).toMatchObject({
      complete: false,
      reason: 'turn_in_progress',
    })
  })

  it('reports a running turn ahead of an unreachable workspace', () => {
    const running = facts({ chat_status: 'agent', workspace_status: 'stopped' })
    expect(evaluateSettlement(running).reason).toBe('turn_in_progress')
  })

  it('does not settle a workspace that was never drained', () => {
    expect(evaluateSettlement(facts({ drained_through: null }))).toMatchObject({
      complete: false,
      reason: 'pending_settle',
    })
  })

  it('settles an empty session once the workspace has been drained', () => {
    // Nothing to account for, and a drain proved the agent had nothing to give.
    expect(evaluateSettlement(facts({ activity_at: null }))).toMatchObject({
      complete: true,
      reason: null,
    })
  })

  it('settles a deleted workspace whose final drain outlived it', () => {
    // Deleting collects first, and the watermark is kept for exactly this: the
    // account is closed and provably whole, so it must not read as lost.
    const deleted = facts({ workspace_status: null, chat_status: null })
    expect(evaluateSettlement(deleted)).toMatchObject({ complete: true, reason: null })
  })

  it('still refuses a deleted workspace that was force-deleted undrained', () => {
    const forced = facts({
      workspace_status: null,
      chat_status: null,
      drained_through: drainedAfter(-60_000),
    })
    expect(evaluateSettlement(forced)).toMatchObject({
      complete: false,
      reason: 'workspace_gone',
    })
  })

  it('does not settle an empty session before any drain', () => {
    expect(evaluateSettlement(facts({ activity_at: null, drained_through: null })).complete).toBe(
      false,
    )
  })

  it.each([
    // Transcripts are read out of the running pod, so anything else is a wait
    // that polling alone will not end.
    ['running', 'pending_settle'],
    ['stopped', 'agent_unreachable'],
    ['error', 'agent_unreachable'],
    ['starting', 'agent_unreachable'],
    [null, 'workspace_gone'],
  ] as const)('reads workspace status %s as reason %s', (workspace_status, reason) => {
    const stale = facts({ drained_through: drainedAfter(-60_000), workspace_status })
    expect(evaluateSettlement(stale).reason).toBe(reason)
  })

  it('echoes the facts the verdict was drawn from', () => {
    const f = facts()
    expect(evaluateSettlement(f)).toMatchObject({
      drained_through: f.drained_through,
      activity_at: f.activity_at,
    })
  })
})
