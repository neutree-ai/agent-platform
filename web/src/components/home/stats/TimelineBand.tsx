import type { ApiRuntimeTimeline } from '@/lib/api/types'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'

type Segment = ApiRuntimeTimeline['segments'][number]

/**
 * Segments are coloured by what they cost, not by how alarming they sound:
 * anything holding a pod is the same "up" colour, anything holding only its
 * volume is the muted one. `error` is called out because a workspace can sit
 * there burning its request without doing work.
 */
function toneOf(phase: string): string {
  if (phase === 'error') return 'bg-warning'
  if (phase === 'running' || phase === 'starting') return 'bg-primary'
  return 'bg-foreground/[0.12]'
}

/**
 * A workspace's runtime as one horizontal band, laid out in real time — segment
 * widths are their share of the window, so a long idle stretch looks long. In a
 * narrow panel this is the only honest way to show a timeline: a chart would
 * need axes it has no room for.
 */
export function TimelineBand({ segments }: { segments: Segment[] }) {
  const { t } = useTranslation()
  if (segments.length === 0) return null

  const start = new Date(segments[0].startedAt).getTime()
  const end = new Date(segments[segments.length - 1].endedAt).getTime()
  const span = Math.max(1, end - start)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-6 gap-[1px] overflow-hidden rounded-md bg-foreground/[0.04]">
        {segments.map((s) => {
          const width =
            ((new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / span) * 100
          return (
            <div
              key={s.startedAt}
              className={cn('h-full', toneOf(s.phase))}
              style={{ width: `${width}%` }}
              title={t('components.shell.resourcesApp.segmentTooltip', {
                phase: s.phase,
                from: new Date(s.startedAt).toLocaleString(),
                to: new Date(s.endedAt).toLocaleString(),
              })}
            />
          )
        })}
      </div>
      <div className="flex items-center justify-between text-[10px] tabular-nums text-muted-foreground/60">
        <span>{new Date(start).toLocaleDateString()}</span>
        <span>{new Date(end).toLocaleDateString()}</span>
      </div>
    </div>
  )
}
