import { describe, expect, it } from 'vitest'
import type { ToolCallRow } from './db/session-tool-calls'
import { coveredMs, normalizeToolName, summarizeToolActivity } from './session-tool-activity'

const T0 = 1_786_000_000_000

function call(over: Partial<ToolCallRow> = {}): ToolCallRow {
  return { callId: 'c1', name: 'execute', startedMs: T0, completedMs: T0 + 1_000, ...over }
}

describe('normalizeToolName', () => {
  it('keeps a plain tool name', () => {
    expect(normalizeToolName('execute')).toBe('execute')
    expect(normalizeToolName('mcp__platform__run_command')).toBe('mcp__platform__run_command')
  })

  it('drops the argument a tool names itself after', () => {
    expect(normalizeToolName('Open page: https://example.com/a/b')).toBe('Open')
    expect(normalizeToolName('Edit /workspace/AGENTS.md')).toBe('Edit')
    expect(normalizeToolName('Web search: site:example.com "query"')).toBe('Web')
  })

  it('falls back to the raw name rather than returning nothing', () => {
    expect(normalizeToolName('  ')).toBe('  ')
    expect(normalizeToolName(': x')).toBe(': x')
  })
})

describe('coveredMs', () => {
  it('counts overlap once', () => {
    // Two sub-agents running tools at the same time is 10s of wall clock, not 20.
    expect(
      coveredMs([
        { start: 0, end: 10 },
        { start: 0, end: 10 },
      ]),
    ).toBe(10)
  })

  it('adds disjoint stretches', () => {
    expect(
      coveredMs([
        { start: 0, end: 5 },
        { start: 10, end: 15 },
      ]),
    ).toBe(10)
  })

  it('joins stretches that touch', () => {
    expect(
      coveredMs([
        { start: 0, end: 10 },
        { start: 5, end: 20 },
      ]),
    ).toBe(20)
  })

  it('is order-independent', () => {
    expect(
      coveredMs([
        { start: 10, end: 15 },
        { start: 0, end: 5 },
      ]),
    ).toBe(10)
  })

  it('is zero for nothing', () => {
    expect(coveredMs([])).toBe(0)
  })
})

describe('summarizeToolActivity', () => {
  it('never reports more tool time than wall clock, however concurrent the calls', () => {
    const activity = summarizeToolActivity({
      calls: [
        call({ callId: 'a', startedMs: T0, completedMs: T0 + 10_000 }),
        call({ callId: 'b', startedMs: T0, completedMs: T0 + 10_000 }),
        call({ callId: 'c', startedMs: T0, completedMs: T0 + 10_000 }),
      ],
      errorCallIds: [],
    })
    expect(activity.wallMs).toBe(10_000)
    expect(activity.toolMs).toBe(10_000)
    // The per-tool figure is the summed one — three calls' worth of work.
    expect(activity.tools[0].seconds).toBe(30)
  })

  it('still tallies tools when the core stamped no timings', () => {
    const activity = summarizeToolActivity({
      calls: [
        call({ callId: 'a', name: 'Read a.md', startedMs: null, completedMs: null }),
        call({ callId: 'b', name: 'Read b.md', startedMs: null, completedMs: null }),
      ],
      errorCallIds: ['b'],
    })
    expect(activity.timedCalls).toBe(0)
    expect(activity.tools).toEqual([
      { name: 'Read', calls: 2, timedCalls: 0, seconds: 0, avgSeconds: 0, errors: 1 },
    ])
  })

  it('averages over the calls that were timed, not over all of them', () => {
    const activity = summarizeToolActivity({
      calls: [
        call({ startedMs: T0, completedMs: T0 + 4_000 }),
        call({ startedMs: null, completedMs: null }),
      ],
      errorCallIds: [],
    })
    expect(activity.tools[0]).toMatchObject({ calls: 2, timedCalls: 1, avgSeconds: 4 })
  })

  it('treats a completion stamped before its start as zero, not negative', () => {
    const activity = summarizeToolActivity({
      calls: [call({ startedMs: T0, completedMs: T0 - 5_000 })],
      errorCallIds: [],
    })
    expect(activity.tools[0].seconds).toBe(0)
    expect(activity.toolMs).toBe(0)
  })

  it('fills every bucket, however idle the calendar span was', () => {
    // Two calls a day apart. Bucketed by time this would be two lit columns and
    // 58 empty ones; bucketed by order it is two full buckets.
    const activity = summarizeToolActivity({
      calls: [
        call({ callId: 'a', startedMs: T0, completedMs: T0 + 1_000 }),
        call({ callId: 'b', startedMs: T0 + 86_400_000, completedMs: T0 + 86_401_000 }),
      ],
      errorCallIds: [],
    })
    expect(activity.buckets).toHaveLength(2)
    expect(activity.buckets.every((b) => Object.keys(b.tools).length > 0)).toBe(true)
  })

  it('never makes more buckets than there are calls', () => {
    const activity = summarizeToolActivity({ calls: [call()], errorCallIds: [] })
    expect(activity.buckets).toHaveLength(1)
  })

  it('caps the strip so a huge session still fits the panel', () => {
    const calls = Array.from({ length: 500 }, (_, i) =>
      call({ callId: `c${i}`, startedMs: T0 + i, completedMs: T0 + i + 1 }),
    )
    const activity = summarizeToolActivity({ calls, errorCallIds: [] })
    expect(activity.buckets).toHaveLength(60)
    const counted = activity.buckets.reduce(
      (sum, b) => sum + Object.values(b.tools).reduce((a, x) => a + x, 0),
      0,
    )
    // Every call lands in exactly one bucket — none dropped, none double-counted.
    expect(counted).toBe(500)
  })

  it('charts calls the core left untimed, which a time axis could not place', () => {
    const activity = summarizeToolActivity({
      calls: [
        call({ callId: 'a', name: 'Read a.md', startedMs: null, completedMs: null }),
        call({ callId: 'b', name: 'Edit b.md', startedMs: null, completedMs: null }),
      ],
      errorCallIds: [],
    })
    expect(activity.timedCalls).toBe(0)
    expect(activity.buckets).toHaveLength(2)
    expect(activity.buckets[0].startedAt).toBeNull()
  })

  it('folds the long tail into one row that keeps its totals', () => {
    // Eight tools, five charted: the other three become a single row whose
    // numbers still add up, so the list never grows with the tail.
    const calls = Array.from({ length: 8 }, (_, i) =>
      call({
        callId: `c${i}`,
        name: `tool${i}`,
        startedMs: T0,
        completedMs: T0 + (8 - i) * 1_000,
      }),
    )
    const activity = summarizeToolActivity({ calls, errorCallIds: ['c6'] })

    expect(activity.chartedTools).toEqual(['tool0', 'tool1', 'tool2', 'tool3', 'tool4'])
    expect(activity.otherToolCount).toBe(3)
    expect(activity.tools.map((x) => x.name)).toEqual([
      'tool0',
      'tool1',
      'tool2',
      'tool3',
      'tool4',
      'other',
    ])
    // tool5 + tool6 + tool7 = 3s + 2s + 1s
    expect(activity.tools[5]).toMatchObject({ calls: 3, seconds: 6, avgSeconds: 2, errors: 1 })
  })

  it('names the folded row "other" even when the tail is a single tool', () => {
    const calls = Array.from({ length: 6 }, (_, i) =>
      call({ callId: `c${i}`, name: `tool${i}`, startedMs: T0, completedMs: T0 + (6 - i) * 1_000 }),
    )
    const activity = summarizeToolActivity({ calls, errorCallIds: [] })
    expect(activity.otherToolCount).toBe(1)
    expect(activity.tools.at(-1)?.name).toBe('other')
  })

  it('leaves the list alone when nothing needs folding', () => {
    const activity = summarizeToolActivity({ calls: [call()], errorCallIds: [] })
    expect(activity.otherToolCount).toBe(0)
    expect(activity.tools.map((x) => x.name)).toEqual(['execute'])
  })

  it('charts the tail as one series too, so list and chart share a legend', () => {
    const calls = Array.from({ length: 8 }, (_, i) =>
      call({ callId: `c${i}`, name: `tool${i}`, startedMs: T0, completedMs: T0 + (8 - i) * 1_000 }),
    )
    const activity = summarizeToolActivity({ calls, errorCallIds: [] })
    const labels = new Set(activity.buckets.flatMap((b) => Object.keys(b.tools)))
    expect(labels.has('other')).toBe(true)
    expect(labels.has('tool7')).toBe(false)
  })

  it('is empty for a session that called nothing', () => {
    expect(summarizeToolActivity({ calls: [], errorCallIds: [] }).tools).toEqual([])
  })
})
