import { StatShell } from '@/components/home/StatShell'
import { TokenCompositionBar } from '@/components/home/TokenCompositionBar'
import { SessionUsageList, formatDuration } from '@/components/home/stats/SessionUsageList'
import { TimelineBand } from '@/components/home/stats/TimelineBand'
import { ToolActivityCard } from '@/components/home/stats/ToolActivityCard'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Spinner } from '@/components/ui/spinner'
import { api } from '@/lib/api/client'
import type { ApiSessionUsageList } from '@/lib/api/types'
import { formatTokenCount } from '@/lib/format-tokens'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatCoreHours, formatGib } from './OverviewCards'

type SessionUsage = ApiSessionUsageList['sessions'][number]

/**
 * Infra for one workspace. Deliberately a timeline rather than a total: the
 * question at this depth is not how much but when and for how long, which is
 * what makes a stretch of untouched running time visible as a shape.
 */
export function WorkspaceInfra({ workspaceId, days }: { workspaceId: string; days: number }) {
  const { t } = useTranslation()
  const { data, isLoading } = useQuery({
    queryKey: ['runtime-timeline', workspaceId, days],
    queryFn: () => api.getWorkspaceRuntimeTimeline(workspaceId, days),
  })

  if (isLoading) return <Loading />
  const segments = data?.segments ?? []
  if (segments.length === 0) return <Empty />

  const current = segments[segments.length - 1]
  const coreHours = segments.reduce(
    (sum, s) =>
      sum +
      (s.replicas *
        s.coreRequest *
        (new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime())) /
        3_600_000,
    0,
  )

  return (
    <>
      <StatShell
        label={t('components.shell.resourcesApp.timelineLabel')}
        aside={t('components.shell.resourcesApp.storageHeld', {
          value: formatGib(current.storageGib),
        })}
        caption={t('components.shell.resourcesApp.timelineCaption')}
      >
        <div className="flex items-end gap-4">
          <span className="text-4xl font-semibold tabular-nums leading-none text-foreground">
            {formatCoreHours(coreHours)}
          </span>
          <span className="pb-0.5 text-[11px] text-muted-foreground/70">
            {t('components.shell.resourcesApp.coreHours')}
          </span>
        </div>
        <TimelineBand segments={segments} />
      </StatShell>
    </>
  )
}

/** Token for one workspace: which sessions spent it, and what that cost in turns and time. */
export function WorkspaceToken({
  workspaceId,
  days,
  onSelect,
}: {
  workspaceId: string
  days: number
  onSelect: (session: SessionUsage) => void
}) {
  const { t } = useTranslation()
  const { data, isLoading } = useQuery({
    queryKey: ['session-usage', workspaceId, days],
    queryFn: () => api.getWorkspaceSessionUsage(workspaceId, days),
  })

  if (isLoading) return <Loading />
  const sessions = data?.sessions ?? []
  if (sessions.length === 0) return <Empty />

  return (
    <StatShell
      label={t('components.shell.resourcesApp.sessionsLabel')}
      aside={formatTokenCount(sessions.reduce((sum, s) => sum + s.tokens, 0))}
    >
      <SessionUsageList sessions={sessions} onSelect={onSelect} />
    </StatShell>
  )
}

/**
 * One session, where the two categories meet: a session is the unit whose turn
 * count explains both the tokens it burned and the wall clock it held, so
 * splitting this depth by category would show two half-empty views.
 */
export function SessionDetail({
  workspaceId,
  session,
}: {
  workspaceId: string
  session: SessionUsage
}) {
  const { t } = useTranslation()
  const { data, isLoading } = useQuery({
    queryKey: ['session-token-usage', workspaceId, session.sessionId],
    queryFn: () => api.getSessionUsage(workspaceId, session.sessionId),
  })
  // The tool breakdown is diagnostic rather than part of the cost picture, so
  // it stays folded away — and unfetched — until someone goes looking for it.
  const [toolsOpen, setToolsOpen] = useState(false)
  const { data: activity } = useQuery({
    queryKey: ['session-tool-activity', workspaceId, session.sessionId],
    queryFn: () => api.getSessionToolActivity(workspaceId, session.sessionId),
    enabled: toolsOpen,
  })

  return (
    <>
      <StatShell label={t('components.shell.resourcesApp.sessionShapeLabel')}>
        <div className="grid grid-cols-3 gap-2">
          <Figure
            label={t('components.shell.resourcesApp.messagesLabel')}
            value={session.messages}
          />
          <Figure
            label={t('components.shell.resourcesApp.toolCallsLabel')}
            value={session.toolCalls}
          />
          <Figure
            label={t('components.shell.resourcesApp.durationLabel')}
            value={formatDuration(session.durationSec)}
          />
        </div>
      </StatShell>

      {isLoading && <Loading />}
      {data && (
        <StatShell
          label={t('components.shell.tokenUsage.compositionLabel')}
          aside={formatTokenCount(
            data.totals.input_tokens +
              data.totals.output_tokens +
              data.totals.cache_read_tokens +
              data.totals.cache_creation_tokens,
          )}
        >
          <TokenCompositionBar
            composition={{
              input: data.totals.input_tokens,
              output: data.totals.output_tokens,
              cacheRead: data.totals.cache_read_tokens,
              cacheCreation: data.totals.cache_creation_tokens,
            }}
          />
        </StatShell>
      )}

      <Collapsible open={toolsOpen} onOpenChange={setToolsOpen}>
        <CollapsibleTrigger className="group flex w-full items-center gap-1.5 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70 hover:text-foreground/80">
          <ChevronRight className="h-3 w-3 transition-transform group-data-[state=open]:rotate-90" />
          {t('components.shell.resourcesApp.toolBreakdown')}
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-3 pt-2">
          {activity ? <ToolActivityCard activity={activity} /> : <Loading />}
        </CollapsibleContent>
      </Collapsible>
    </>
  )
}

function Figure({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-muted-foreground/70">{label}</span>
      <span className="text-2xl font-semibold tabular-nums leading-none text-foreground">
        {value}
      </span>
    </div>
  )
}

function Loading() {
  return (
    <div className="flex h-24 items-center justify-center">
      <Spinner />
    </div>
  )
}

function Empty() {
  const { t } = useTranslation()
  return (
    <div className="flex h-24 items-center justify-center text-[12px] text-muted-foreground/60">
      {t('components.shell.resourcesApp.empty')}
    </div>
  )
}
