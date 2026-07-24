import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { useSkillDependents } from '@/hooks/useSkills'
import { api } from '@/lib/api/client'
import type {
  ApiSkill,
  ApiTeam,
  SkillGrant,
  SkillPermission,
  SkillVisibility,
} from '@/lib/api/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Lock, Users, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

// private < team < public — a move to a lower rank can revoke access from
// other users' workspaces that already mount the skill.
const VISIBILITY_RANK: Record<SkillVisibility, number> = { private: 0, team: 1, public: 2 }

interface SkillShareDialogProps {
  skill: ApiSkill | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Owner-only dialog for skill visibility + team grants. Split out from the
 * upload/edit dialog so non-owner editors (who can re-import or edit
 * description) don't see the sharing controls at all.
 */
export function SkillShareDialog({ skill, open, onOpenChange }: SkillShareDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const [visibility, setVisibility] = useState<SkillVisibility>('private')
  const [teamGrants, setTeamGrants] = useState<Record<string, SkillPermission>>({})
  const [error, setError] = useState<string | null>(null)

  const { data: teams = [] } = useQuery<ApiTeam[]>({
    queryKey: ['teams'],
    queryFn: () => api.listTeams(),
    enabled: open,
  })

  // Occupancy preview so the owner sees, before saving, that narrowing
  // visibility would strip access from other users' workspaces (the save
  // is blocked server-side while any exist). Cross-user names stay hidden —
  // we only surface the count.
  const { data: dependents } = useSkillDependents(skill?.id, open)
  const narrowing = !!skill && VISIBILITY_RANK[visibility] < VISIBILITY_RANK[skill.visibility]
  const blockedByOthers = narrowing && !!dependents && dependents.other_workspace_count > 0

  useEffect(() => {
    if (!open || !skill) return
    setVisibility(skill.visibility)
    setTeamGrants({})
    setError(null)
    if (skill.visibility === 'team') {
      api
        .listSkillGrants(skill.id)
        .then((rows) => {
          const next: Record<string, SkillPermission> = {}
          for (const r of rows) next[r.team_id] = r.permission
          setTeamGrants(next)
        })
        .catch(() => {})
    }
  }, [open, skill])

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!skill) throw new Error('No skill')
      const teamIds = Object.keys(teamGrants)
      const grants: SkillGrant[] =
        visibility === 'team'
          ? teamIds.map((team_id) => ({ team_id, permission: teamGrants[team_id] }))
          : []
      return api.updateSkillMeta(skill.id, { visibility, grants })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skills'] })
      onOpenChange(false)
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : t('components.skillShare.errors.saveFailed'))
    },
  })

  function toggleTeam(id: string) {
    setTeamGrants((prev) => {
      if (id in prev) {
        const { [id]: _, ...rest } = prev
        return rest
      }
      return { ...prev, [id]: 'viewer' }
    })
  }

  function setTeamPermission(id: string, perm: SkillPermission) {
    setTeamGrants((prev) => ({ ...prev, [id]: perm }))
  }

  function handleSave() {
    setError(null)
    if (visibility === 'team' && Object.keys(teamGrants).length === 0) {
      setError(t('components.skillShare.errors.teamRequired'))
      return
    }
    saveMutation.mutate()
  }

  if (!skill) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('components.skillShare.title', { name: skill.name })}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex flex-col gap-1.5 rounded-md border border-border/60 bg-muted/30 p-3">
            <Label className="block text-xs">{t('components.skillShare.fields.visibility')}</Label>
            <SegmentedControl<SkillVisibility>
              variant="box"
              size="md"
              value={visibility}
              onValueChange={setVisibility}
              options={[
                {
                  value: 'private',
                  label: t('components.skillShare.visibility.private'),
                  icon: Lock,
                },
                {
                  value: 'team',
                  label: t('components.skillShare.visibility.team'),
                  icon: Users,
                },
                { value: 'public', label: t('components.skillShare.visibility.public') },
              ]}
            />
            <div className="text-tiny text-muted-foreground">
              {t(`components.skillShare.visibilityDesc.${visibility}`)}
            </div>
          </div>

          {visibility === 'team' && (
            <div className="flex flex-col gap-1.5">
              <Label className="block text-tiny text-muted-foreground">
                {t('components.skillShare.fields.teams')}
              </Label>
              {teams.length === 0 ? (
                <div className="text-tiny text-muted-foreground">
                  {t('components.skillShare.teamsEmpty')}
                </div>
              ) : (
                <>
                  {Object.keys(teamGrants).length === 0 ? (
                    <div className="text-tiny text-muted-foreground/70">
                      {t('components.skillShare.noTeamsShared')}
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {Object.entries(teamGrants).map(([teamId, perm]) => {
                        const team = teams.find((x) => x.id === teamId)
                        return (
                          <div
                            key={teamId}
                            className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-card px-2.5 py-1.5"
                          >
                            <span className="min-w-0 flex-1 truncate text-xs">
                              {team?.name ?? teamId}
                            </span>
                            <SegmentedControl<SkillPermission>
                              variant="pill"
                              size="sm"
                              value={perm}
                              onValueChange={(v) => setTeamPermission(teamId, v)}
                              options={[
                                {
                                  value: 'viewer',
                                  label: t('components.skillShare.permission.viewer'),
                                },
                                {
                                  value: 'editor',
                                  label: t('components.skillShare.permission.editor'),
                                },
                              ]}
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                              onClick={() => toggleTeam(teamId)}
                              title={t('components.skillShare.removeTeam')}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                  {teams.some((tm) => !(tm.id in teamGrants)) && (
                    <Combobox
                      placeholder={t('components.skillShare.addTeam')}
                      value=""
                      onValueChange={(id) => id && toggleTeam(id)}
                      options={teams
                        .filter((tm) => !(tm.id in teamGrants))
                        .map((tm) => ({ value: tm.id, label: tm.name }))}
                    />
                  )}
                </>
              )}
            </div>
          )}

          {blockedByOthers && dependents && (
            <div className="rounded-md border border-warning/40 bg-warning/10 p-2 text-tiny text-warning">
              {t('components.skillShare.narrowWarning', {
                count: dependents.other_workspace_count,
              })}
            </div>
          )}

          {error && <div className="text-xs text-destructive">{error}</div>}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="button" size="sm" onClick={handleSave} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
