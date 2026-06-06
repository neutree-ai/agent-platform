import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { ApiTeamworkRosterCandidate } from '@/lib/api/types'
import { cn } from '@/lib/utils'
import type { ChatMessage, ToolCall } from '@/stores/agent-session-store'
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  MessageSquareReply,
  Network,
  Send,
  User,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

// Tolerates host runtimes that prefix tool names (`mcp__tos-platform__call_agent` etc.)
const CALL_AGENT_RE = /(^|[^A-Za-z0-9_])call_agent$/
const GET_AGENT_RESULT_RE = /(^|[^A-Za-z0-9_])get_agent_result$/

// Columns scale fluidly to fill available width — MIN_COL_W is the floor;
// once columns × MIN_COL_W exceeds the panel, the strip starts to scroll.
const MIN_COL_W = 32
const LANE_H = 28
const LABEL_W = 96

type DispatchMode = 'foreground' | 'background'
type DispatchStatus = 'running' | 'done' | 'error'

type EventKind =
  | { kind: 'user'; text: string }
  | {
      kind: 'dispatch'
      slug: string
      mode: DispatchMode
      isContinuation: boolean
      status: DispatchStatus
      prompt: string
    }
  | {
      kind: 'response'
      slug: string
      mode: DispatchMode
      status: DispatchStatus
      text: string | null
    }

interface TimelineEvent {
  id: string
  /** Column index, dense from 0. */
  col: number
  lane: string
  kind: EventKind
}

interface OrchestrationModel {
  columns: number
  /** 'coord' first, then sub session keys in first-dispatch order. */
  laneOrder: string[]
  laneLabels: Map<string, string>
  events: TimelineEvent[]
  /** Pairs (col, fromLane, toLane) used to draw vertical connectors. */
  connectors: Array<{ col: number; from: string; to: string }>
}

function extractCallAgentArgs(
  tool: ToolCall,
): { slug: string; mode: DispatchMode; givenSessionId: string | null; prompt: string } | null {
  const rawArgs =
    tool.input && typeof tool.input === 'object' && 'arguments' in tool.input
      ? (tool.input as Record<string, unknown>).arguments
      : tool.input
  const args = (rawArgs as Record<string, unknown> | undefined) ?? {}
  const slug = typeof args.slug === 'string' ? (args.slug as string) : null
  if (!slug) return null
  const mode: DispatchMode = args.mode === 'background' ? 'background' : 'foreground'
  const givenSessionId = typeof args.session_id === 'string' ? (args.session_id as string) : null
  const prompt = typeof args.prompt === 'string' ? (args.prompt as string) : ''
  return { slug, mode, givenSessionId, prompt }
}

// Peel the MCP `{ content: [{ type:'text', text:... }] }` envelope when
// present and return the inner text. Returns null for shapes we don't
// understand.
function peelMcpEnvelope(result: unknown): string | null {
  if (result == null) return null
  if (typeof result === 'string') {
    try {
      const outer = JSON.parse(result)
      if (
        outer &&
        Array.isArray(outer.content) &&
        outer.content[0]?.type === 'text' &&
        typeof outer.content[0].text === 'string'
      ) {
        return outer.content[0].text as string
      }
      return result
    } catch {
      return result
    }
  }
  if (typeof result === 'object') {
    const env = result as { content?: Array<{ type?: string; text?: string }> }
    if (
      Array.isArray(env.content) &&
      env.content[0]?.type === 'text' &&
      typeof env.content[0].text === 'string'
    ) {
      return env.content[0].text
    }
    try {
      return JSON.stringify(result)
    } catch {
      return null
    }
  }
  return null
}

interface ParsedDispatchResult {
  sessionId: string | null
  text: string | null
}

function parseCallAgentResult(result: unknown): ParsedDispatchResult {
  const text = peelMcpEnvelope(result)
  if (text == null) return { sessionId: null, text: null }
  try {
    const parsed = JSON.parse(text) as { session_id?: string; text?: string }
    return { sessionId: parsed?.session_id ?? null, text: parsed?.text ?? null }
  } catch {
    return { sessionId: null, text }
  }
}

function extractSessionIdArg(tool: ToolCall): string | null {
  const rawArgs =
    tool.input && typeof tool.input === 'object' && 'arguments' in tool.input
      ? (tool.input as Record<string, unknown>).arguments
      : tool.input
  const args = (rawArgs as Record<string, unknown> | undefined) ?? {}
  return typeof args.session_id === 'string' ? args.session_id : null
}

function resolveSlugName(slug: string, candidates: ApiTeamworkRosterCandidate[]): string {
  if (slug.includes('/')) {
    const [owner, bare] = slug.split('/')
    return candidates.find((x) => x.owner === owner && x.slug === bare)?.name ?? slug
  }
  return candidates.find((x) => x.is_own && x.slug === slug)?.name ?? slug
}

function deriveOrchestrationModel(
  messages: ChatMessage[],
  candidates: ApiTeamworkRosterCandidate[],
  coordinatorName: string,
): OrchestrationModel {
  const events: TimelineEvent[] = []
  const connectors: OrchestrationModel['connectors'] = []
  const laneOrder: string[] = ['coord']
  const laneLabels = new Map<string, string>([['coord', coordinatorName]])
  let col = 0

  // For background dispatches, coord later polls get_agent_result to fetch
  // the real reply. Track each response event by its session_id so the
  // backfill can hydrate text + flip status from running → done.
  const responseBySessionId = new Map<string, TimelineEvent>()

  for (const m of messages) {
    if (m.role === 'user') {
      events.push({
        id: `user:${m.id}`,
        col: col++,
        lane: 'coord',
        kind: { kind: 'user', text: m.content ?? '' },
      })
    }

    for (const block of m.blocks) {
      if (block.type !== 'tool') continue
      const tool = block.tool

      if (!CALL_AGENT_RE.test(tool.name)) {
        if (GET_AGENT_RESULT_RE.test(tool.name)) {
          const sid = extractSessionIdArg(tool)
          if (sid) {
            const resp = responseBySessionId.get(sid)
            if (resp && resp.kind.kind === 'response') {
              const resultText = peelMcpEnvelope(tool.result)
              if (resultText) {
                resp.kind.text = resultText
                resp.kind.status = tool.isError ? 'error' : 'done'
              } else if (tool.isError) {
                resp.kind.status = 'error'
              }
            }
          }
        }
        continue
      }

      const args = extractCallAgentArgs(tool)
      if (!args) continue
      const parsed = parseCallAgentResult(tool.result)
      // Continuation when the caller passed a session_id; lane keyed on that
      // id so multi-turn dispatches stack on the same row.
      const targetKey = args.givenSessionId ?? parsed.sessionId ?? `pending:${args.slug}:${tool.id}`
      const isContinuation = args.givenSessionId != null
      const dispatchStatus: DispatchStatus = tool.isError
        ? 'error'
        : tool.resultAt != null || tool.completedAt != null
          ? 'done'
          : 'running'
      // For background, call_agent returns synchronously with {status:'started'}
      // and no text — the agent is still running. The real reply lands later
      // via a get_agent_result tool call and is backfilled above.
      const responseStatus: DispatchStatus =
        args.mode === 'background' && !parsed.text && !tool.isError ? 'running' : dispatchStatus

      if (!laneLabels.has(targetKey)) {
        laneOrder.push(targetKey)
        laneLabels.set(targetKey, resolveSlugName(args.slug, candidates))
      }

      const dispatchCol = col++
      events.push({
        id: `disp:${tool.id}`,
        col: dispatchCol,
        lane: 'coord',
        kind: {
          kind: 'dispatch',
          slug: args.slug,
          mode: args.mode,
          isContinuation,
          status: dispatchStatus,
          prompt: args.prompt,
        },
      })
      const respEvent: TimelineEvent = {
        id: `resp:${tool.id}`,
        col: dispatchCol,
        lane: targetKey,
        kind: {
          kind: 'response',
          slug: args.slug,
          mode: args.mode,
          status: responseStatus,
          text: parsed.text,
        },
      }
      events.push(respEvent)
      const sidForBackfill = parsed.sessionId ?? args.givenSessionId
      if (sidForBackfill) responseBySessionId.set(sidForBackfill, respEvent)
      connectors.push({ col: dispatchCol, from: 'coord', to: targetKey })
    }
  }

  // Same workspace can host multiple parallel sessions (Demo B / fan-out
  // workers). Disambiguate with #N by encounter order when a label appears
  // more than once across sub lanes.
  const subKeys = laneOrder.filter((k) => k !== 'coord')
  const baseCounts = new Map<string, number>()
  for (const k of subKeys) {
    const base = laneLabels.get(k) ?? k
    baseCounts.set(base, (baseCounts.get(base) ?? 0) + 1)
  }
  const seen = new Map<string, number>()
  for (const k of subKeys) {
    const base = laneLabels.get(k) ?? k
    if ((baseCounts.get(base) ?? 0) <= 1) continue
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    laneLabels.set(k, `${base} #${n}`)
  }

  return { columns: col, laneOrder, laneLabels, events, connectors }
}

function statusIcon(status: DispatchStatus): ReactNode {
  if (status === 'running') return <Loader2 className="h-3 w-3 animate-spin" />
  if (status === 'error') return <AlertCircle className="h-3 w-3" />
  return <Check className="h-3 w-3" />
}

function dotShellClasses(event: TimelineEvent): string {
  const base =
    'flex h-[22px] w-[22px] items-center justify-center rounded-full border bg-card transition-colors'
  const { kind } = event
  if (kind.kind === 'user') return cn(base, 'border-accent text-accent-foreground bg-accent')
  const errored = kind.status === 'error'
  const color = errored ? 'border-destructive text-destructive' : 'border-info text-info'
  const dashed = kind.mode === 'background' && 'border-dashed'
  if (kind.kind === 'response') {
    return cn(
      base,
      color,
      dashed,
      // Running response gets a softer ring so an unanswered dispatch is
      // distinguishable from a completed one at a glance.
      kind.status === 'running' && 'border-info/60',
    )
  }
  return cn(base, color, dashed)
}

function dotIcon(event: TimelineEvent): ReactNode {
  const { kind } = event
  if (kind.kind === 'user') return <User className="h-3 w-3" />
  if (kind.kind === 'response') return statusIcon(kind.status)
  return kind.isContinuation ? (
    <MessageSquareReply className="h-3 w-3" />
  ) : (
    <Send className="h-3 w-3" />
  )
}

function PreviewBlock({ text, mono }: { text: string; mono?: boolean }) {
  return (
    <ScrollArea className="max-h-40 rounded-sm border bg-muted/40 p-2">
      <pre
        className={cn(
          'whitespace-pre-wrap break-words text-[11px] leading-snug text-foreground/85',
          mono ? 'font-mono' : 'font-sans',
        )}
      >
        {text}
      </pre>
    </ScrollArea>
  )
}

function EventPopoverContent({
  event,
  laneLabel,
  onOpenChat,
  canOpenChat,
}: {
  event: TimelineEvent
  laneLabel: string
  onOpenChat: () => void
  canOpenChat: boolean
}) {
  const { t } = useTranslation()
  const { kind } = event

  let header: ReactNode = null
  let body: ReactNode = null

  if (kind.kind === 'user') {
    header = (
      <HeaderRow
        icon={<User className="h-3 w-3" />}
        title={t('components.teamworkSection.timeline.popover.user', 'User input')}
      />
    )
    body = kind.text ? (
      <PreviewBlock text={kind.text} />
    ) : (
      <EmptyHint
        text={t('components.teamworkSection.timeline.popover.userEmpty', '(empty input)')}
      />
    )
  } else if (kind.kind === 'dispatch') {
    const chips: string[] = []
    // Only annotate non-default variants — the icon + status dot already
    // convey new-foreground-completed, the most common case.
    if (kind.isContinuation)
      chips.push(t('components.teamworkSection.timeline.popover.continue', 'continue'))
    if (kind.mode === 'background')
      chips.push(t('components.teamworkSection.timeline.popover.background', 'background'))
    if (kind.status === 'error')
      chips.push(t('components.teamworkSection.timeline.popover.error', 'error'))
    header = (
      <HeaderRow
        icon={
          kind.isContinuation ? (
            <MessageSquareReply className="h-3 w-3" />
          ) : (
            <Send className="h-3 w-3" />
          )
        }
        title={`→ ${kind.slug}`}
        chips={chips}
        chipTone={kind.status === 'error' ? 'destructive' : 'info'}
      />
    )
    body = kind.prompt ? (
      <PreviewBlock text={kind.prompt} />
    ) : (
      <EmptyHint
        text={t('components.teamworkSection.timeline.popover.promptEmpty', '(empty prompt)')}
      />
    )
  } else {
    const chips: string[] = []
    if (kind.mode === 'background')
      chips.push(t('components.teamworkSection.timeline.popover.background', 'background'))
    if (kind.status === 'error')
      chips.push(t('components.teamworkSection.timeline.popover.error', 'error'))
    header = (
      <HeaderRow
        icon={statusIcon(kind.status)}
        title={kind.slug}
        chips={chips}
        chipTone={kind.status === 'error' ? 'destructive' : 'info'}
      />
    )
    body =
      kind.text != null ? (
        <PreviewBlock text={kind.text} />
      ) : (
        <EmptyHint
          text={
            kind.status === 'running'
              ? t('components.teamworkSection.timeline.popover.running', '(still running)')
              : t('components.teamworkSection.timeline.popover.replyEmpty', '(no reply)')
          }
        />
      )
  }

  return (
    <div className="space-y-2 text-xs">
      {header}
      {body}
      {canOpenChat && (
        <div className="flex justify-end pt-0.5">
          <Button
            type="button"
            variant="ghost"
            className="h-6 gap-0.5 px-1.5 text-[11px] font-normal text-muted-foreground hover:text-foreground"
            onClick={onOpenChat}
          >
            {t('components.teamworkSection.timeline.popover.openChat', 'Open {{lane}} chat', {
              lane: laneLabel,
            })}
            <ChevronRight className="h-3 w-3" />
          </Button>
        </div>
      )}
    </div>
  )
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="rounded-sm border border-dashed bg-muted/30 p-2 text-[11px] text-muted-foreground">
      {text}
    </div>
  )
}

function HeaderRow({
  icon,
  title,
  chips,
  chipTone,
}: {
  icon: ReactNode
  title: string
  chips?: string[]
  chipTone?: 'info' | 'destructive'
}) {
  const toneClass =
    chipTone === 'destructive' ? 'bg-destructive/10 text-destructive' : 'bg-info/10 text-info'
  return (
    <div className="flex items-center gap-1.5">
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{title}</span>
      {chips && chips.length > 0 && (
        <span className="flex shrink-0 gap-1">
          {chips.map((c) => (
            <span
              key={c}
              className={cn('rounded-sm px-1 py-px text-[9px] font-medium leading-none', toneClass)}
            >
              {c}
            </span>
          ))}
        </span>
      )}
    </div>
  )
}

export function TeamworkTimeline({
  coordMessages,
  candidates,
  coordinatorName,
  activeLane,
  onLaneSelect,
  className,
}: {
  coordMessages: ChatMessage[]
  candidates: ApiTeamworkRosterCandidate[]
  coordinatorName: string
  /** Lane key currently bound to the chat panel below ('coord' or a session id). */
  activeLane: string
  /** Called when the user picks a lane via timeline. The caller maps it to its tab state. */
  onLaneSelect: (lane: string) => void
  className?: string
}) {
  const { t } = useTranslation()
  const model = useMemo(
    () => deriveOrchestrationModel(coordMessages, candidates, coordinatorName),
    [coordMessages, candidates, coordinatorName],
  )

  const [collapsed, setCollapsed] = useState(false)

  if (model.columns === 0) {
    return (
      <div
        className={cn(
          'mx-2 mt-3 mb-1 flex h-12 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-xs text-muted-foreground shadow-sm',
          className,
        )}
      >
        {t('components.teamworkSection.timeline.empty', 'Waiting for activity…')}
      </div>
    )
  }

  const runningCount = model.events.reduce(
    (n, e) => n + (e.kind.kind === 'response' && e.kind.status === 'running' ? 1 : 0),
    0,
  )
  const gridHeight = model.laneOrder.length * LANE_H
  const dotsMinWidth = model.columns * MIN_COL_W

  return (
    <div
      className={cn(
        'relative mx-2 mt-3 mb-1 shrink-0 overflow-hidden rounded-lg border border-border bg-card shadow-sm',
        className,
      )}
    >
      {/* Soft chroma overlay — barely-there gradient so the strip reads as a
          stage, not flat chrome. Stays under content via pointer-events-none. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-r from-info/[0.05] via-transparent to-accent/[0.05]"
      />

      <div className="relative px-4 py-3">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="group flex w-full items-center gap-2 text-left"
          aria-expanded={!collapsed}
        >
          <ChevronDown
            className={cn(
              'h-3 w-3 shrink-0 text-muted-foreground transition-transform group-hover:text-foreground',
              collapsed && '-rotate-90',
            )}
          />
          <span className="text-xs font-medium text-foreground">
            {t('components.teamworkSection.timeline.title', 'Orchestration')}
          </span>
          <span className="flex-1" />
          {runningCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-sm bg-info/10 px-1 py-px font-mono text-[10px] tabular-nums text-info">
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              {runningCount}
            </span>
          )}
        </button>

        {!collapsed && (
          <div className="mt-2 max-h-[220px] overflow-auto">
            <div className="flex" style={{ minWidth: LABEL_W + dotsMinWidth }}>
              {/* Labels column */}
              <div className="shrink-0" style={{ width: LABEL_W }}>
                {model.laneOrder.map((lane) => {
                  const active = lane === activeLane
                  const isPending = lane.startsWith('pending:')
                  const label = model.laneLabels.get(lane) ?? lane
                  const icon = lane === 'coord' ? <Network className="h-3 w-3" /> : null
                  return (
                    <button
                      key={lane}
                      type="button"
                      onClick={() => !isPending && onLaneSelect(lane)}
                      disabled={isPending}
                      className={cn(
                        'flex w-full items-center gap-1.5 rounded-md pr-2 pl-2 text-left text-xs transition-colors',
                        active
                          ? 'bg-primary/10 text-foreground'
                          : 'text-muted-foreground hover:text-foreground',
                        isPending && 'opacity-60',
                      )}
                      style={{ height: LANE_H }}
                      title={isPending ? `${label} (resolving session…)` : label}
                    >
                      {icon}
                      <span className="truncate">{label}</span>
                    </button>
                  )
                })}
              </div>

              {/* Dots area — fluid; columns evenly distribute the remaining width. */}
              <div className="relative flex-1" style={{ height: gridHeight }}>
                {/* Lane rails — a thin horizontal line per lane so empty rows
                    still have structure; active lane rail is tinted primary. */}
                {model.laneOrder.map((lane, laneIdx) => (
                  <div
                    key={`rail:${lane}`}
                    className={cn(
                      'absolute inset-x-0 h-px',
                      lane === activeLane ? 'bg-primary/40' : 'bg-info/15',
                    )}
                    style={{ top: laneIdx * LANE_H + LANE_H / 2 }}
                  />
                ))}

                {/* Connectors — SVG sits at the same coord system as the dots area
                    (no viewBox), so percentage x values track lane width. */}
                <svg className="pointer-events-none absolute inset-0 h-full w-full">
                  <title>connectors</title>
                  {model.connectors.map((c) => {
                    const fromIdx = model.laneOrder.indexOf(c.from)
                    const toIdx = model.laneOrder.indexOf(c.to)
                    if (fromIdx < 0 || toIdx < 0) return null
                    const xPct = ((c.col + 0.5) / model.columns) * 100
                    const y1 = fromIdx * LANE_H + LANE_H / 2
                    const y2 = toIdx * LANE_H + LANE_H / 2
                    return (
                      <line
                        key={`${c.col}-${c.from}-${c.to}`}
                        x1={`${xPct}%`}
                        x2={`${xPct}%`}
                        y1={y1}
                        y2={y2}
                        className="stroke-info/40"
                        strokeWidth={1}
                        strokeDasharray="2 2"
                      />
                    )
                  })}
                </svg>

                {/* Event dots */}
                {model.events.map((e) => {
                  const laneIdx = model.laneOrder.indexOf(e.lane)
                  if (laneIdx < 0) return null
                  const lane = e.lane
                  const isPending = lane.startsWith('pending:')
                  const laneLabel = model.laneLabels.get(lane) ?? lane
                  const leftPct = ((e.col + 0.5) / model.columns) * 100
                  const top = laneIdx * LANE_H + LANE_H / 2 - 11
                  return (
                    <Popover key={e.id}>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className={cn(
                            'absolute -translate-x-1/2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-full',
                            dotShellClasses(e),
                          )}
                          style={{ left: `${leftPct}%`, top }}
                        >
                          {dotIcon(e)}
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        align="center"
                        sideOffset={6}
                        collisionPadding={12}
                        className="w-auto max-w-[min(22rem,calc(100vw-2rem))] p-3"
                      >
                        <EventPopoverContent
                          event={e}
                          laneLabel={laneLabel}
                          canOpenChat={!isPending}
                          onOpenChat={() => onLaneSelect(lane)}
                        />
                      </PopoverContent>
                    </Popover>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
