import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { formatTokenCount } from '../lib/format-tokens'
import { useTranslation } from 'react-i18next'

const TURN_WARN_THRESHOLD = 150
const CONTEXT_WARN_THRESHOLD = 80

interface TurnStatsBarProps {
  turns: number
  contextTokens?: number
  contextWindow?: number
}

function contextColor(pct: number): string {
  if (pct > CONTEXT_WARN_THRESHOLD) return 'bg-destructive'
  if (pct > 60) return 'bg-warning'
  return 'bg-info'
}

export function TurnStatsBar({ turns, contextTokens, contextWindow }: TurnStatsBarProps) {
  const { t } = useTranslation()
  if (turns <= 0 && !contextTokens) return null

  const turnWarn = turns > TURN_WARN_THRESHOLD
  const turnLabel = turns > 0 ? t('components.chat.turnStatsBar.turns', { count: turns }) : null

  const contextPct =
    contextTokens && contextWindow
      ? Math.min(Math.round((contextTokens / contextWindow) * 100), 100)
      : null
  const contextWarn = contextPct != null && contextPct > CONTEXT_WARN_THRESHOLD

  return (
    <div className="px-3 py-1 text-mini text-muted-foreground text-right border-t border-border flex items-center justify-end gap-3">
      {contextPct != null && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-1.5 cursor-default">
              <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${contextColor(contextPct)}`}
                  style={{ width: `${contextPct}%` }}
                />
              </div>
              <span className={contextWarn ? 'text-destructive' : undefined}>{contextPct}%</span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top">
            {t('components.chat.turnStatsBar.context', {
              used: formatTokenCount(contextTokens!),
              total: formatTokenCount(contextWindow!),
            })}
            {contextWarn ? ` - ${t('components.chat.turnStatsBar.contextWarning')}` : ''}
          </TooltipContent>
        </Tooltip>
      )}
      {turnLabel &&
        (turnWarn ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-destructive cursor-default">{turnLabel}</span>
            </TooltipTrigger>
            <TooltipContent side="top">
              {t('components.chat.turnStatsBar.turnWarning')}
            </TooltipContent>
          </Tooltip>
        ) : (
          <span>{turnLabel}</span>
        ))}
    </div>
  )
}
