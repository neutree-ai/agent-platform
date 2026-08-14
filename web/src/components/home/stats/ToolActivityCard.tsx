import { SplitBar } from '@/components/home/SplitBar'
import { StatShell } from '@/components/home/StatShell'
import { formatDuration } from '@/components/home/stats/SessionUsageList'
import type { ApiSessionToolActivity } from '@/lib/api/types'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'

/**
 * One class per charted tool, in rank order, plus the fold for everything else.
 * Tokens only — these have to hold up in both themes.
 */
const TOOL_TONES = ['bg-primary', 'bg-info', 'bg-success', 'bg-warning', 'bg-accent']
const OTHER_TONE = 'bg-foreground/[0.18]'

/** Matches the label the server folds the tail of the tool list into. */
const OTHER_TOOL = 'other'

/** Same hatch idiom the token composition bar uses to mark a sub-portion. */
const HATCH =
  'bg-[repeating-linear-gradient(45deg,currentColor_0px,currentColor_2.5px,transparent_2.5px,transparent_4px)]'

function toneFor(tool: string, charted: string[]): string {
  const index = charted.indexOf(tool)
  return index === -1 ? OTHER_TONE : TOOL_TONES[index % TOOL_TONES.length]
}

/**
 * What a session's tool calls did with its wall clock.
 *
 * Three readings, coarse to fine: how much of the session was spent in tools at
 * all, when that time fell, and which tools it went to. The middle one carries
 * the weight — an agent repeating one tool without progress is invisible in any
 * total but unmistakable as a long unbroken run of one colour.
 */
export function ToolActivityCard({ activity }: { activity: ApiSessionToolActivity }) {
  const { t } = useTranslation()
  if (activity.tools.length === 0) return null

  const timed = activity.timedCalls > 0
  const otherMs = Math.max(0, activity.wallMs - activity.toolMs)

  return (
    <>
      {timed && (
        <StatShell
          label={t('components.shell.resourcesApp.timeSplitLabel')}
          aside={formatDuration(activity.wallMs / 1000)}
        >
          <SplitBar
            segments={[
              { key: 'tool', className: 'bg-primary', value: activity.toolMs },
              { key: 'other', className: OTHER_TONE, value: otherMs },
            ]}
          />
          <div className="flex items-center justify-between gap-4 text-[11px]">
            <Legend
              tone="bg-primary"
              label={t('components.shell.resourcesApp.inTool')}
              value={formatDuration(activity.toolMs / 1000)}
            />
            <Legend
              tone={OTHER_TONE}
              label={t('components.shell.resourcesApp.waiting')}
              value={formatDuration(otherMs / 1000)}
            />
          </div>
        </StatShell>
      )}

      {activity.buckets.length > 0 && (
        <StatShell
          label={t('components.shell.resourcesApp.toolTimelineLabel')}
          caption={t('components.shell.resourcesApp.toolTimelineCaption')}
        >
          <BucketChart activity={activity} />
        </StatShell>
      )}

      <StatShell
        label={t('components.shell.resourcesApp.byToolLabel')}
        aside={t('components.shell.resourcesApp.callCount', {
          count: activity.tools.reduce((sum, x) => sum + x.calls, 0),
        })}
      >
        {activity.tools.map((tool) => (
          <ToolRow
            key={tool.name}
            tool={tool}
            tone={toneFor(tool.name, activity.chartedTools)}
            max={Math.max(...activity.tools.map((x) => (timed ? x.seconds : x.calls)), 1)}
            timed={timed}
            foldedCount={tool.name === OTHER_TOOL ? activity.otherToolCount : 0}
          />
        ))}
      </StatShell>
    </>
  )
}

/**
 * Calls per bucket, stacked by tool, walking left to right through the session
 * in call order rather than in time. Bars are scaled to the busiest bucket, so
 * the shape reads as "how hard was it working here" and the colours as "on
 * what" — and a stretch of one colour is an agent repeating itself.
 */
function BucketChart({ activity }: { activity: ApiSessionToolActivity }) {
  const totals = activity.buckets.map((b) => Object.values(b.tools).reduce((a, x) => a + x, 0))
  const max = Math.max(...totals, 1)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-12 items-end gap-px">
        {activity.buckets.map((bucket, i) => (
          <div
            key={bucket.startedAt ?? i}
            className="flex min-w-0 flex-1 flex-col-reverse"
            style={{ height: `${(totals[i] / max) * 100}%` }}
            title={bucket.startedAt ? new Date(bucket.startedAt).toLocaleString() : undefined}
          >
            {Object.entries(bucket.tools)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([tool, seconds]) => (
                <div
                  key={tool}
                  className={toneFor(tool, activity.chartedTools)}
                  style={{ height: `${(seconds / Math.max(totals[i], 1)) * 100}%` }}
                />
              ))}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {activity.chartedTools.map((tool) => (
          <span key={tool} className="flex items-center gap-1.5 text-[11px]">
            <span
              className={cn('h-2 w-2 shrink-0 rounded-[2px]', toneFor(tool, activity.chartedTools))}
            />
            <span className="truncate text-muted-foreground/80">{tool}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

/**
 * A tool's row carries both measures on purpose. Many fast calls (an editor)
 * and many slow ones (a shell that keeps timing out) are the same number in a
 * single-measure list and completely different problems.
 */
function ToolRow({
  tool,
  tone,
  max,
  timed,
  foldedCount,
}: {
  tool: ApiSessionToolActivity['tools'][number]
  tone: string
  max: number
  timed: boolean
  /** Non-zero on the folded row: how many tools it stands for. */
  foldedCount: number
}) {
  const { t } = useTranslation()
  const value = timed ? tool.seconds : tool.calls
  const errorShare = tool.calls > 0 ? tool.errors / tool.calls : 0

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 text-[12px]">
        <span className="truncate text-foreground/80">
          {foldedCount > 0
            ? t('components.shell.resourcesApp.otherTools', { count: foldedCount })
            : tool.name}
        </span>
        <span className="shrink-0 tabular-nums text-muted-foreground/70">
          {timed
            ? formatDuration(tool.seconds)
            : t('components.shell.resourcesApp.callCount', { count: tool.calls })}
        </span>
      </div>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-foreground/[0.05]">
        <div
          className={cn('h-full', tone)}
          style={{ width: `${(value / max) * (1 - errorShare) * 100}%` }}
        />
        {errorShare > 0 && (
          <div
            className={cn('h-full text-destructive', HATCH)}
            style={{ width: `${(value / max) * errorShare * 100}%` }}
          />
        )}
      </div>
      <div className="text-[11px] tabular-nums text-muted-foreground/60">
        {t('components.shell.resourcesApp.toolDetail', {
          calls: tool.calls,
          avg: timed ? formatDuration(tool.avgSeconds) : '—',
        })}
        {tool.errors > 0 && (
          <span className="text-destructive/80">
            {' · '}
            {t('components.shell.resourcesApp.errorCount', { count: tool.errors })}
          </span>
        )}
      </div>
    </div>
  )
}

function Legend({ tone, label, value }: { tone: string; label: string; value: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn('h-2 w-2 shrink-0 rounded-[2px]', tone)} />
      <span className="text-muted-foreground/80">{label}</span>
      <span className="tabular-nums text-foreground/80">{value}</span>
    </span>
  )
}
