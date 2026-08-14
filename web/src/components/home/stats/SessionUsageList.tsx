import type { ApiSessionUsageList } from '@/lib/api/types'
import { formatTokenCount } from '@/lib/format-tokens'
import { useTranslation } from 'react-i18next'

type SessionUsage = ApiSessionUsageList['sessions'][number]

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  return `${(seconds / 3600).toFixed(1)}h`
}

/**
 * Sessions ranked by tokens, each showing the turns and wall-clock that produced
 * them. The three numbers sit together on purpose: a session with few messages,
 * hundreds of tool calls and hours on the clock is an agent going in circles,
 * and that is visible by reading across the row.
 */
export function SessionUsageList({
  sessions,
  onSelect,
}: {
  sessions: SessionUsage[]
  onSelect: (session: SessionUsage) => void
}) {
  const { t } = useTranslation()
  const max = Math.max(...sessions.map((s) => s.tokens), 1)

  return (
    <div className="flex flex-col gap-2.5">
      {sessions.map((s) => (
        <button
          type="button"
          key={s.sessionId}
          onClick={() => onSelect(s)}
          className="flex flex-col gap-1 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-foreground/[0.04]"
        >
          <div className="flex items-baseline justify-between gap-2 text-[12px]">
            <span className="truncate text-foreground/80">
              {s.name || t('components.shell.resourcesApp.untitledSession')}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground/70">
              {formatTokenCount(s.tokens)}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-foreground/[0.05]">
            <div
              className="h-full rounded-full bg-primary/60"
              style={{ width: `${(s.tokens / max) * 100}%` }}
            />
          </div>
          <div className="text-[11px] tabular-nums text-muted-foreground/60">
            {t('components.shell.resourcesApp.sessionDetail', {
              messages: s.messages,
              tools: s.toolCalls,
              duration: formatDuration(s.durationSec),
            })}
          </div>
        </button>
      ))}
    </div>
  )
}
