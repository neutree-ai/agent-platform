import { useRangeControl } from '@/components/home/RangeControl'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Spinner } from '@/components/ui/spinner'
import { api } from '@/lib/api/client'
import type { ApiSessionUsageList } from '@/lib/api/types'
import type { AppComponentProps } from '@/lib/app-registry'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityOverview } from './ActivityCards'
import { SessionDetail, WorkspaceInfra, WorkspaceToken } from './DetailCards'
import { InfraOverview, TokenOverview, type WorkspacePick } from './OverviewCards'

type Category = 'token' | 'infra' | 'activity'
type SessionUsage = ApiSessionUsageList['sessions'][number]

interface Focus {
  workspace: WorkspacePick
  session?: SessionUsage
}

/**
 * Stats — one app over everything a user's own work produces, split by the
 * question being asked rather than by where the data comes from: what the model
 * consumed, what the infrastructure is holding, and what the user actually did.
 *
 * Model and infra cost do not share a drill-down axis, which is why the app is
 * a category switch rather than one long page. Token cost belongs to a session
 * and adds up; infra cost belongs to a stretch of wall clock that no session
 * owns, so its depth is a timeline and sessions only annotate it.
 *
 * The focus is one shared state: switching category keeps your place, and
 * clearing it is the overview. Focus is intentionally not persisted — reopening
 * the app should land on the overview, not on a filter nobody remembers setting.
 */
export function StatsApp({ instanceId }: AppComponentProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { days, control } = useRangeControl(instanceId, 'statsRange')
  const [category, setCategory] = useState<Category>('token')
  const [focus, setFocus] = useState<Focus | null>(null)

  const { data: usage } = useQuery({
    queryKey: ['usage-summary', days],
    queryFn: () => api.getUsageSummary(days),
    refetchInterval: 60_000,
  })

  const { data: activity } = useQuery({
    queryKey: ['activity-summary', days],
    queryFn: () => api.getActivitySummary(days),
    refetchInterval: 60_000,
    enabled: category === 'activity',
  })

  const { data: resources, isLoading } = useQuery({
    queryKey: ['resource-summary', days],
    queryFn: () => api.getResourceSummary(days),
    refetchInterval: 60_000,
  })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['resource-summary'] })
    queryClient.invalidateQueries({ queryKey: ['workspaces'] })
  }
  const stop = useMutation({
    mutationFn: (id: string) => api.stopWorkspace(id),
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteWorkspace(id),
    onSuccess: () => {
      setFocus(null)
      refresh()
    },
  })

  // A session is where the categories converge, so the switch has nothing left
  // to switch between and would only offer two views of the same thing.
  const showCategories = !focus?.session

  const body = () => {
    if (category === 'activity') return <ActivityOverview activity={activity} />
    if (focus?.session) {
      return <SessionDetail workspaceId={focus.workspace.workspaceId} session={focus.session} />
    }
    if (focus) {
      return category === 'infra' ? (
        <WorkspaceInfra workspaceId={focus.workspace.workspaceId} days={days} />
      ) : (
        <WorkspaceToken
          workspaceId={focus.workspace.workspaceId}
          days={days}
          onSelect={(session) => setFocus({ workspace: focus.workspace, session })}
        />
      )
    }
    if (category === 'infra') {
      return (
        resources && (
          <InfraOverview
            resources={resources}
            onPick={(workspace) => setFocus({ workspace })}
            onStop={(id) => stop.mutate(id)}
            onDelete={(id) => remove.mutate(id)}
            stopping={stop.isPending}
            deleting={remove.isPending}
          />
        )
      )
    }
    return usage && <TokenOverview usage={usage} onPick={(workspace) => setFocus({ workspace })} />
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {control}

      <div className="flex flex-col gap-2 px-3 pt-3">
        {showCategories && (
          <SegmentedControl<Category>
            value={category}
            onValueChange={setCategory}
            mode="tabs"
            ariaLabel={t('components.shell.resourcesApp.categoryAria')}
            options={[
              { value: 'token', label: t('components.shell.resourcesApp.category.token') },
              { value: 'infra', label: t('components.shell.resourcesApp.category.infra') },
              { value: 'activity', label: t('components.shell.resourcesApp.category.activity') },
            ]}
          />
        )}
        {focus && category !== 'activity' && (
          <Trail
            focus={focus}
            onRoot={() => setFocus(null)}
            onWorkspace={() => setFocus({ workspace: focus.workspace })}
          />
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {isLoading && !resources && category !== 'activity' ? (
          <div className="flex h-32 items-center justify-center">
            <Spinner />
          </div>
        ) : (
          <div className="flex flex-col gap-3">{body()}</div>
        )}
      </div>
    </div>
  )
}

/** The focus stack, read left to right. Each step back is one click. */
function Trail({
  focus,
  onRoot,
  onWorkspace,
}: {
  focus: Focus
  onRoot: () => void
  onWorkspace: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground/70">
      <button type="button" onClick={onRoot} className="shrink-0 hover:text-foreground/80">
        {t('components.shell.resourcesApp.overview')}
      </button>
      <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/40" />
      <button
        type="button"
        onClick={onWorkspace}
        className={
          focus.session ? 'truncate hover:text-foreground/80' : 'truncate text-foreground/80'
        }
      >
        {focus.workspace.name}
      </button>
      {focus.session && (
        <>
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/40" />
          <span className="truncate text-foreground/80">
            {focus.session.name || t('components.shell.resourcesApp.untitledSession')}
          </span>
        </>
      )}
    </div>
  )
}
