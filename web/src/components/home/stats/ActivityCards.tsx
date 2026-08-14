import { PunchCard } from '@/components/home/PunchCard'
import { StatCard } from '@/components/home/StatCard'
import { StatShell } from '@/components/home/StatShell'
import type { ApiActivitySummary } from '@/lib/api/types'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

interface SparkPoint {
  value: number
  tooltip: string
}

/**
 * What the user did, as opposed to what it cost — today's interactions and new
 * sessions against the selected window, and a heatmap of when the work happens.
 */
export function ActivityOverview({ activity }: { activity: ApiActivitySummary | undefined }) {
  const { t } = useTranslation()

  const stats = useMemo(() => {
    const daily = activity?.daily ?? []
    const spark = (pick: (d: (typeof daily)[number]) => number): SparkPoint[] =>
      daily.map((d) => ({
        value: pick(d),
        tooltip: t('components.shell.activityApp.cellTooltip', { date: d.date, count: pick(d) }),
      }))
    const today = daily[daily.length - 1]
    return {
      interactionsToday: today?.interactions ?? 0,
      interactionsSpark: spark((d) => d.interactions),
      sessionsToday: today?.sessions ?? 0,
      sessionsSpark: spark((d) => d.sessions),
      punch: activity?.punch_card ?? [],
    }
  }, [activity, t])

  return (
    <>
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
      <StatShell
        label={t('components.shell.activityApp.punchLabel')}
        caption={t('components.shell.activityApp.punchCaption')}
      >
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
      </StatShell>
    </>
  )
}
