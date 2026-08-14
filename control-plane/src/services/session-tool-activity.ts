import type { ApiSessionToolActivity } from '../../../internal/types/api'
import type { SessionToolCalls, ToolCallRow } from './db/session-tool-calls'

/** Widest the strip gets — roughly one bucket per pixel column at panel width. */
const MAX_BUCKETS = 60

/** Tools charted individually before the rest are folded together. */
const CHARTED_TOOLS = 5

/** The label the remaining tools are folded into. */
const OTHER_TOOL = 'other'

/**
 * Many tools name themselves after what they did rather than what they are —
 * "Open page: https://…", "Edit /workspace/AGENTS.md", "Web search: site:…".
 * Taken raw that is neither a stable identifier nor safe as a label: it is an
 * unbounded set, and it carries file paths and search queries into a field that
 * reads as a tool name.
 *
 * The first token is the tool and the rest is argument, across both the colon
 * and the space convention. Measured over the live event log, that takes 2,449
 * distinct names down to 124, all of them recognisable tools.
 */
export function normalizeToolName(name: string): string {
  const head = name.trim().split(/[\s:]/, 1)[0]
  return head || name
}

interface Interval {
  start: number
  end: number
}

/**
 * Total time covered by these intervals, counting overlap once. Sub-agents run
 * tools concurrently, so summing durations can exceed the session's own wall
 * clock and would show a share above 100%.
 */
export function coveredMs(intervals: Interval[]): number {
  const sorted = [...intervals].sort((a, b) => a.start - b.start)
  let covered = 0
  let open: Interval | null = null
  for (const interval of sorted) {
    if (!open) {
      open = { ...interval }
    } else if (interval.start > open.end) {
      covered += open.end - open.start
      open = { ...interval }
    } else if (interval.end > open.end) {
      open.end = interval.end
    }
  }
  if (open) covered += open.end - open.start
  return covered
}

/**
 * A call's interval, or null when the agent core did not stamp one. Only some
 * cores record `started_at`/`completed_at`, so timing is a bonus on top of the
 * call itself rather than something every row has.
 */
function intervalOf(call: ToolCallRow): Interval | null {
  if (call.startedMs === null || call.completedMs === null) return null
  // A completion stamped before its start is clock skew, not negative time.
  return { start: call.startedMs, end: Math.max(call.startedMs, call.completedMs) }
}

const EMPTY: ApiSessionToolActivity = {
  wallMs: 0,
  toolMs: 0,
  timedCalls: 0,
  tools: [],
  chartedTools: [],
  otherToolCount: 0,
  buckets: [],
  startedAt: null,
  endedAt: null,
}

/**
 * Turns a session's tool calls into the three things worth looking at: which
 * tools ran, where the wall clock went, and how that spending was spread over
 * the session.
 *
 * The spread is the point. A session stuck in a loop is not distinguishable
 * from a busy one by any single total, but it is obvious as a long stretch of
 * one colour — a shape rather than a judgement, so nothing here has to decide
 * what "stuck" means.
 *
 * Only the timing half depends on the agent core stamping its calls. The tool
 * tally is built from every call, so a core that reports no timings still gets
 * counts and errors instead of an empty card.
 */
export function summarizeToolActivity({
  calls,
  errorCallIds,
}: SessionToolCalls): ApiSessionToolActivity {
  const named = calls.filter((c) => c.name)
  if (named.length === 0) return EMPTY

  const errored = new Set(errorCallIds)
  const timed: (Interval & { tool: string })[] = []
  const stats = new Map<string, { calls: number; timedCalls: number; ms: number; errors: number }>()

  for (const call of named) {
    const tool = normalizeToolName(call.name as string)
    const stat = stats.get(tool) ?? { calls: 0, timedCalls: 0, ms: 0, errors: 0 }
    stat.calls += 1
    if (call.callId && errored.has(call.callId)) stat.errors += 1
    const interval = intervalOf(call)
    if (interval) {
      stat.timedCalls += 1
      stat.ms += interval.end - interval.start
      timed.push({ ...interval, tool })
    }
    stats.set(tool, stat)
  }

  // Carries raw milliseconds through the ranking so the fold below sums exact
  // values rather than re-deriving them from a rounded average.
  const ranked = [...stats]
    .map(([name, s]) => ({ name, ...s }))
    .sort((a, b) => b.ms - a.ms || b.calls - a.calls)

  const present = ({ name, calls, timedCalls, ms, errors }: (typeof ranked)[number]) => ({
    name,
    calls,
    timedCalls,
    // Summed, not covered: this answers "how much work went through this
    // tool", where counting concurrent calls separately is the honest reading.
    seconds: Math.round(ms / 1000),
    avgSeconds: timedCalls > 0 ? ms / timedCalls / 1000 : 0,
    errors,
  })

  const chartedTools = ranked.slice(0, CHARTED_TOOLS).map((t) => t.name)
  // A session can touch a hundred distinct tools, most of them used once.
  // Listing the tail row by row buries the few that account for the time, so it
  // folds into a single row that still carries its totals — and the list then
  // matches the chart's series exactly, letting one legend serve both.
  const charted = new Set(chartedTools)
  const tail = ranked.slice(CHARTED_TOOLS)
  const tools = ranked.slice(0, CHARTED_TOOLS).map(present)
  if (tail.length > 0) {
    tools.push(
      present(
        tail.reduce(
          (sum, t) => ({
            name: OTHER_TOOL,
            calls: sum.calls + t.calls,
            timedCalls: sum.timedCalls + t.timedCalls,
            ms: sum.ms + t.ms,
            errors: sum.errors + t.errors,
          }),
          { name: OTHER_TOOL, calls: 0, timedCalls: 0, ms: 0, errors: 0 },
        ),
      ),
    )
  }

  // Sequence, not wall clock. Measured over live sessions, tool time is 0.1–2%
  // of the calendar span a session covers: someone starts a session, walks away,
  // comes back the next day. Bucketing by time spends the whole strip drawing
  // the walking-away and squeezes the work into a pixel. Bucketing by call
  // order makes every bucket carry calls, and a loop — a run of the same tool —
  // is a property of the order anyway.
  //
  // Height is call count for the same reason it is not duration: a loop is many
  // repeated calls, and counting works even for the cores that stamp no timings.
  const bucketCount = Math.min(MAX_BUCKETS, named.length)
  const perBucket = named.length / bucketCount
  const buckets = Array.from({ length: bucketCount }, (_, i) => {
    const slice = named.slice(Math.floor(i * perBucket), Math.floor((i + 1) * perBucket))
    const tools: Record<string, number> = {}
    for (const call of slice) {
      const tool = normalizeToolName(call.name as string)
      const label = charted.has(tool) ? tool : OTHER_TOOL
      tools[label] = (tools[label] ?? 0) + 1
    }
    const first = slice.find((c) => c.startedMs !== null)
    return { startedAt: first ? new Date(first.startedMs as number).toISOString() : null, tools }
  })

  if (timed.length === 0) {
    return { ...EMPTY, tools, chartedTools, otherToolCount: tail.length, buckets }
  }

  const start = Math.min(...timed.map((i) => i.start))
  const end = Math.max(...timed.map((i) => i.end))

  return {
    wallMs: end - start,
    toolMs: coveredMs(timed),
    timedCalls: timed.length,
    tools,
    chartedTools,
    otherToolCount: tail.length,
    buckets,
    startedAt: new Date(start).toISOString(),
    endedAt: new Date(end).toISOString(),
  }
}
