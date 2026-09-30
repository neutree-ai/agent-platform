import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { api } from '@/lib/api/client'
import type { Workspace } from '@/lib/api/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

function useWorkspaceTeamShares(workspaceId: string) {
  return useQuery({
    queryKey: ['workspace-team-shares', workspaceId],
    queryFn: () => api.listWorkspaceTeamShares(workspaceId),
  })
}

/**
 * General-section row for sharing a workspace with teams. The owner toggles
 * each of their teams; a team member sees who shared it and with which teams.
 */
export function ShareWithTeamsRow({ workspace }: { workspace: Workspace }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const isOwner = workspace.access === 'owner'
  const { data: shares = [], isLoading: sharesLoading } = useWorkspaceTeamShares(workspace.id)
  const { data: teams = [], isLoading: teamsLoading } = useQuery({
    queryKey: ['teams'],
    queryFn: () => api.listTeams(),
    enabled: isOwner,
  })

  const toggle = useMutation({
    mutationFn: ({ teamId, shared }: { teamId: string; shared: boolean }) =>
      shared
        ? api.shareWorkspaceWithTeam(workspace.id, teamId)
        : api.revokeWorkspaceTeamShare(workspace.id, teamId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-team-shares', workspace.id] })
      queryClient.invalidateQueries({ queryKey: ['workspaces'] })
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : t('components.workspaceShare.errors.update'),
      ),
  })

  const sharedTeamIds = new Set(shares.map((s) => s.team_id))

  return (
    <div className="flex flex-col gap-2">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <Users className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          {t('components.workspaceShare.title')}
          {toggle.isPending && <Spinner size="sm" className="h-3 w-3" />}
        </div>
        <p className="mt-1 text-mini text-muted-foreground">
          {isOwner
            ? t('components.workspaceShare.ownerDescription')
            : t('components.workspaceShare.memberDescription', { owner: workspace.owner })}
        </p>
      </div>

      {isOwner ? (
        teamsLoading || sharesLoading ? (
          <Spinner size="sm" />
        ) : teams.length === 0 ? (
          <p className="text-mini text-muted-foreground">
            {t('components.workspaceShare.noTeams')}
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {teams.map((team) => (
              <div
                key={team.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-2.5 py-1.5"
              >
                <span className="min-w-0 truncate text-xs text-foreground">{team.name}</span>
                <Switch
                  checked={sharedTeamIds.has(team.id)}
                  disabled={toggle.isPending}
                  onCheckedChange={(shared) => toggle.mutate({ teamId: team.id, shared })}
                />
              </div>
            ))}
          </div>
        )
      ) : (
        shares.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {shares.map((s) => (
              <span
                key={s.team_id}
                className="inline-flex items-center rounded-md border border-border/60 px-2 py-0.5 text-xs text-muted-foreground"
              >
                {s.team_name}
              </span>
            ))}
          </div>
        )
      )}
    </div>
  )
}
