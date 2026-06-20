import { PunchCard } from '@/components/home/PunchCard'
import { StatCard } from '@/components/home/StatCard'
import { TokenUsageCard } from '@/components/home/TokenUsageCard'
import { WorkspaceUsageBars } from '@/components/home/WorkspaceUsageBars'
import { useAppHeaderSlot } from '@/components/shell/windows/AppWindow'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Spinner } from '@/components/ui/spinner'
import { api } from '@/lib/api/client'
import type { AppComponentProps } from '@/lib/app-registry'
import { formatTokenCount } from '@/lib/format-tokens'
import { useInstancePersistentState } from '@/stores/instance-state-store'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

type RangeKey = '7d' | '30d' | '90d'

const RANGE_DAYS: Record<RangeKey, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
}

interface SparkPoint {
  value: number
  tooltip: string
}

interface DerivedStats {
  interactionsToday: number
  interactionsSpark: SparkPoint[]
  sessionsToday: number
  sessionsSpark: SparkPoint[]
  punch: { dow: number; hour: number; count: number }[]
}

/**
 * Stats — fleet-scope app surfacing per-user usage. Stat cards (today's
 * interactions / new sessions, with sparklines spanning the selected
 * range) sit above a contribution-style heatmap of daily interactions.
 * The header carries a range picker (7 / 30 / 90 days) persisted to the
 * user's profile so the chosen window survives reloads.
 */
export function ActivityApp({ instanceId }: AppComponentProps) {
  const { t } = useTranslation()
  const headerSlot = useAppHeaderSlot()

  const [range, setRange] = useInstancePersistentState<RangeKey>(
    instanceId,
    'statsRange',
    () => '30d',
  )
  const days = RANGE_DAYS[range]

  const { data: activity, isLoading } = useQuery({
    queryKey: ['activity-summary', days],
    queryFn: () => api.getActivitySummary(days),
    refetchInterval: 60_000,
  })

  const { data: usage } = useQuery({
    queryKey: ['usage-summary', days],
    queryFn: () => api.getUsageSummary(days),
    refetchInterval: 60_000,
  })

  const tipFor = useMemo(
    () => (date: string, value: number) =>
      t('components.shell.activityApp.cellTooltip', { date, count: value }),
    [t],
  )

  const stats = useMemo(() => deriveStats(activity, tipFor), [activity, tipFor])

  const token = useMemo(() => {
    if (!usage) return null
    const { composition } = usage
    const total =
      composition.input + composition.output + composition.cacheRead + composition.cacheCreation
    const sparkline = usage.daily.map((d) => ({
      value: d.tokens,
      tooltip: t('components.shell.activityApp.token.cellTooltip', {
        date: d.date,
        value: formatTokenCount(d.tokens),
      }),
    }))
    return { total, sparkline, composition, byWorkspace: usage.byWorkspace }
  }, [usage, t])

  return (
    <div className="flex h-full min-h-0 flex-col">
      {headerSlot &&
        createPortal(
          <SegmentedControl<RangeKey>
            value={range}
            onValueChange={setRange}
            mode="tabs"
            ariaLabel={t('components.shell.activityApp.rangeAria')}
            options={[
              { value: '7d', label: t('components.shell.activityApp.range.7d') },
              { value: '30d', label: t('components.shell.activityApp.range.30d') },
              { value: '90d', label: t('components.shell.activityApp.range.90d') },
            ]}
          />,
          headerSlot,
        )}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {isLoading && !activity ? (
          <div className="flex h-32 items-center justify-center">
            <Spinner />
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {token && token.total > 0 && (
              <TokenUsageCard
                total={token.total}
                sparkline={token.sparkline}
                composition={token.composition}
              />
            )}
            {token && token.byWorkspace.length > 0 && (
              <div className="flex flex-col gap-3 rounded-lg border border-foreground/[0.06] bg-card/40 p-5">
                <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
                  {t('components.shell.activityApp.token.byWorkspaceLabel')}
                </div>
                <WorkspaceUsageBars items={token.byWorkspace} />
              </div>
            )}
            <StatCard
              label={t('components.shell.activityApp.interactionsToday')}
              value={stats.interactionsToday}
              sparkline={stats.interactionsSpark}
              sparklineAriaLabel={t('components.shell.statCard.aria')}
            />
            <StatCard
              label={t('components.shell.activityApp.sessionsToday')}
              value={stats.sessionsToday}
              sparkline={stats.sessionsSpark}
              sparklineAriaLabel={t('components.shell.statCard.aria')}
            />
            <div className="flex flex-col gap-2 rounded-lg border border-foreground/[0.06] bg-card/40 p-3">
              <div className="flex flex-col gap-0.5">
                <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
                  {t('components.shell.activityApp.punchLabel')}
                </div>
                <div className="text-[11px] text-muted-foreground/60">
                  {t('components.shell.activityApp.punchCaption')}
                </div>
              </div>
              <PunchCard
                data={stats.punch}
                i18n={{
                  cellTooltip: (dow, hour, count) =>
                    t('components.shell.activityApp.punchTooltip', {
                      day: t(`components.shell.activityApp.dow.${dow}`),
                      hour: String(hour).padStart(2, '0'),
                      count,
                    }),
                  hourSuffix: t('components.shell.activityApp.hourSuffix'),
                  dowShort: (dow) => t(`components.shell.activityApp.dow.${dow}`),
                  ariaLabel: t('components.shell.punchCard.aria'),
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function deriveStats(
  activity:
    | {
        daily: { date: string; interactions: number; sessions: number }[]
        punch_card: { dow: number; hour: number; count: number }[]
      }
    | undefined,
  tipFor: (date: string, value: number) => string,
): DerivedStats {
  const daily = activity?.daily ?? []
  const interactionsSpark = daily.map((d) => ({
    value: d.interactions,
    tooltip: tipFor(d.date, d.interactions),
  }))
  const sessionsSpark = daily.map((d) => ({
    value: d.sessions,
    tooltip: tipFor(d.date, d.sessions),
  }))
  const today = daily[daily.length - 1]
  return {
    interactionsToday: today?.interactions ?? 0,
    interactionsSpark,
    sessionsToday: today?.sessions ?? 0,
    sessionsSpark,
    punch: activity?.punch_card ?? [],
  }
}
