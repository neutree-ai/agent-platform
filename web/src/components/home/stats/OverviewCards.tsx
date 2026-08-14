import { ResourceRow } from '@/components/home/ResourceRow'
import { SplitBar } from '@/components/home/SplitBar'
import { StatShell } from '@/components/home/StatShell'
import { TokenUsageCard } from '@/components/home/TokenUsageCard'
import { WorkspaceUsageBars } from '@/components/home/WorkspaceUsageBars'
import type { ApiResourceSummary, ApiUsageSummary } from '@/lib/api/types'
import { formatTokenCount } from '@/lib/format-tokens'
import { Power, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/** How many reclaimable rows to show before the list stops being a list. */
const ROW_LIMIT = 5

export function formatCoreHours(value: number): string {
  return value >= 100 ? Math.round(value).toLocaleString() : value.toFixed(1)
}

export function formatGib(value: number): string {
  return `${Math.round(value).toLocaleString()} GB`
}

export interface WorkspacePick {
  workspaceId: string
  name: string
}

/**
 * Infra overview: what the user's workspaces are holding, split so the part
 * going to workspaces nobody has touched is separated from the part doing work,
 * with the action that releases each one on its row.
 *
 * Stopping frees compute but not the volume, so idle-running and
 * stopped-but-allocated are two lists with two different actions.
 */
export function InfraOverview({
  resources,
  onPick,
  onStop,
  onDelete,
  stopping,
  deleting,
}: {
  resources: ApiResourceSummary
  onPick: (pick: WorkspacePick) => void
  onStop: (workspaceId: string) => void
  onDelete: (workspaceId: string) => void
  stopping: boolean
  deleting: boolean
}) {
  const { t } = useTranslation()
  const { compute, idle, storage } = resources
  const active = Math.max(0, compute.totalCoreHours - compute.idleCoreHours)

  return (
    <>
      {compute.totalCoreHours > 0 && (
        <StatShell
          label={t('components.shell.resourcesApp.computeLabel')}
          aside={t('components.shell.resourcesApp.storageHeld', {
            value: formatGib(storage.totalGib),
          })}
        >
          <div className="flex items-end gap-4">
            <span className="text-4xl font-semibold tabular-nums leading-none text-foreground">
              {formatCoreHours(compute.totalCoreHours)}
            </span>
            <span className="pb-0.5 text-[11px] text-muted-foreground/70">
              {t('components.shell.resourcesApp.coreHours')}
            </span>
          </div>
          <SplitBar
            segments={[
              { key: 'active', className: 'bg-primary', value: active },
              { key: 'idle', className: 'bg-warning', value: compute.idleCoreHours },
            ]}
          />
          <div className="flex items-center justify-between gap-4 text-[11px]">
            <Legend
              tone="bg-primary"
              label={t('components.shell.resourcesApp.active')}
              value={formatCoreHours(active)}
            />
            <Legend
              tone="bg-warning"
              label={t('components.shell.resourcesApp.idle')}
              value={formatCoreHours(compute.idleCoreHours)}
            />
          </div>
        </StatShell>
      )}

      {compute.byWorkspace.length > 0 && (
        <StatShell label={t('components.shell.resourcesApp.computeByWorkspaceLabel')}>
          <WorkspaceUsageBars
            items={compute.byWorkspace.map((w) => ({ ...w, value: w.coreHours }))}
            format={formatCoreHours}
            onSelect={onPick}
          />
        </StatShell>
      )}

      {idle.length > 0 && (
        <StatShell
          label={t('components.shell.resourcesApp.idleLabel')}
          aside={t('components.shell.resourcesApp.idleCount', { count: idle.length })}
          caption={t('components.shell.resourcesApp.idleCaption')}
        >
          {idle.slice(0, ROW_LIMIT).map((w) => (
            <ResourceRow
              key={w.workspaceId}
              name={w.name}
              amount={formatCoreHours(w.coreHours)}
              detail={t('components.shell.resourcesApp.idleDetail', {
                days: Math.floor(w.idleDays),
                cores: w.coreRequest,
              })}
              action={{
                icon: Power,
                label: t('components.shell.resourcesApp.stop'),
                confirmLabel: t('components.shell.resourcesApp.confirm'),
                onConfirm: () => onStop(w.workspaceId),
                pending: stopping,
              }}
            />
          ))}
        </StatShell>
      )}

      {storage.stopped.length > 0 && (
        <StatShell
          label={t('components.shell.resourcesApp.stoppedStorageLabel')}
          aside={formatGib(storage.stopped.reduce((sum, w) => sum + w.storageGib, 0))}
          caption={t('components.shell.resourcesApp.stoppedStorageCaption')}
        >
          {storage.stopped.slice(0, ROW_LIMIT).map((w) => (
            <ResourceRow
              key={w.workspaceId}
              name={w.name}
              amount={formatGib(w.storageGib)}
              detail={t('components.shell.resourcesApp.stoppedDetail', {
                days: Math.floor(w.idleDays),
              })}
              action={{
                icon: Trash2,
                label: t('components.shell.resourcesApp.delete'),
                confirmLabel: t('components.shell.resourcesApp.confirm'),
                onConfirm: () => onDelete(w.workspaceId),
                pending: deleting,
              }}
            />
          ))}
        </StatShell>
      )}
    </>
  )
}

/** Token overview: volume, what kind of tokens it was, and which workspace spent it. */
export function TokenOverview({
  usage,
  onPick,
}: {
  usage: ApiUsageSummary
  onPick: (pick: WorkspacePick) => void
}) {
  const { t } = useTranslation()
  const { composition } = usage
  const total =
    composition.input + composition.output + composition.cacheRead + composition.cacheCreation
  const sparkline = usage.daily.map((d) => ({
    value: d.tokens,
    tooltip: t('components.shell.tokenUsage.cellTooltip', {
      date: d.date,
      value: formatTokenCount(d.tokens),
    }),
  }))

  return (
    <>
      {total > 0 && (
        <TokenUsageCard total={total} sparkline={sparkline} composition={composition} />
      )}
      {usage.byWorkspace.length > 0 && (
        <StatShell label={t('components.shell.tokenUsage.byWorkspaceLabel')}>
          <WorkspaceUsageBars
            items={usage.byWorkspace.map((w) => ({ ...w, value: w.tokens }))}
            format={formatTokenCount}
            onSelect={onPick}
          />
        </StatShell>
      )}
    </>
  )
}

function Legend({ tone, label, value }: { tone: string; label: string; value: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-2 w-2 shrink-0 rounded-[2px] ${tone}`} />
      <span className="text-muted-foreground/80">{label}</span>
      <span className="tabular-nums text-foreground/80">{value}</span>
    </span>
  )
}
