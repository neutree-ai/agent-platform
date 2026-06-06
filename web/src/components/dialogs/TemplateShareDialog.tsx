import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { ApiClientError, api } from '@/lib/api/client'
import type {
  ApiTeam,
  ApiTemplate,
  TemplateGrant,
  TemplateLinkMissingItem,
  TemplatePermission,
  TemplateVisibility,
} from '@/lib/api/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Lock, Users, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface TemplateShareDialogProps {
  template: ApiTemplate | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Owner-only dialog that controls template visibility and team grants. The
 * link-visibility check on the backend may surface a structured `missing[]`
 * list — we render those entries inline so the user can see exactly which
 * prompt/provider needs to be re-shared before this template can go out.
 */
export function TemplateShareDialog({ template, open, onOpenChange }: TemplateShareDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const [visibility, setVisibility] = useState<TemplateVisibility>('private')
  const [teamGrants, setTeamGrants] = useState<Record<string, TemplatePermission>>({})
  const [missing, setMissing] = useState<TemplateLinkMissingItem[]>([])
  const [error, setError] = useState<string | null>(null)

  const { data: teams = [] } = useQuery<ApiTeam[]>({
    queryKey: ['teams'],
    queryFn: () => api.listTeams(),
    enabled: open,
  })

  // Reset + load existing grants when dialog opens
  useEffect(() => {
    if (!open || !template) return
    setVisibility(template.visibility)
    setTeamGrants({})
    setMissing([])
    setError(null)
    if (template.visibility === 'team') {
      api
        .listTemplateGrants(template.id)
        .then((rows) => {
          const next: Record<string, TemplatePermission> = {}
          for (const r of rows) next[r.team_id] = r.permission
          setTeamGrants(next)
        })
        .catch(() => {})
    }
  }, [open, template])

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!template) throw new Error('No template')
      const teamIds = Object.keys(teamGrants)
      const grants: TemplateGrant[] | undefined =
        visibility === 'team'
          ? teamIds.map((team_id) => ({ team_id, permission: teamGrants[team_id] }))
          : []
      return api.updateTemplate(template.id, { visibility, grants })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] })
      onOpenChange(false)
    },
    onError: (err) => {
      // Link-acl violation: backend returns { error, missing[] }. We hide the
      // English `error` string and render the translated `linkMissing.title`
      // header above the structured per-resource list.
      if (err instanceof ApiClientError) {
        const missingItems = err.body.missing as TemplateLinkMissingItem[] | undefined
        if (missingItems && missingItems.length > 0) {
          setMissing(missingItems)
          setError(null)
          return
        }
      }
      setError(err instanceof Error ? err.message : t('components.templateShare.errors.saveFailed'))
    },
  })

  function toggleTeam(id: string) {
    setTeamGrants((prev) => {
      if (id in prev) {
        const next = { ...prev }
        delete next[id]
        return next
      }
      return { ...prev, [id]: 'viewer' }
    })
  }

  function setTeamPermission(id: string, perm: TemplatePermission) {
    setTeamGrants((prev) => ({ ...prev, [id]: perm }))
  }

  function handleSave() {
    setMissing([])
    setError(null)
    if (visibility === 'team' && Object.keys(teamGrants).length === 0) {
      setError(t('components.templateShare.errors.teamRequired'))
      return
    }
    saveMutation.mutate()
  }

  if (!template) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('components.templateShare.title', { name: template.name })}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex flex-col gap-1.5 rounded-md border border-border/60 bg-muted/30 p-3">
            <Label className="block text-xs">
              {t('components.templateShare.fields.visibility')}
            </Label>
            <SegmentedControl<TemplateVisibility>
              variant="box"
              size="md"
              value={visibility}
              onValueChange={(v) => {
                setVisibility(v)
                setMissing([])
              }}
              options={[
                {
                  value: 'private',
                  label: t('components.templateShare.visibility.private'),
                  icon: Lock,
                },
                {
                  value: 'team',
                  label: t('components.templateShare.visibility.team'),
                  icon: Users,
                },
                { value: 'public', label: t('components.templateShare.visibility.public') },
              ]}
            />
            <div className="text-tiny text-muted-foreground">
              {t(`components.templateShare.visibilityDesc.${visibility}`)}
            </div>
          </div>

          {visibility === 'team' && (
            <div className="flex flex-col gap-1.5">
              <Label className="block text-tiny text-muted-foreground">
                {t('components.templateShare.fields.teams')}
              </Label>
              {teams.length === 0 ? (
                <div className="text-tiny text-muted-foreground">
                  {t('components.templateShare.teamsEmpty')}
                </div>
              ) : (
                <>
                  {Object.keys(teamGrants).length === 0 ? (
                    <div className="text-tiny text-muted-foreground/70">
                      {t('components.templateShare.noTeamsShared')}
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
                            <SegmentedControl<TemplatePermission>
                              variant="pill"
                              size="sm"
                              value={perm}
                              onValueChange={(v) => setTeamPermission(teamId, v)}
                              options={[
                                {
                                  value: 'viewer',
                                  label: t('components.templateShare.permission.viewer'),
                                },
                                {
                                  value: 'editor',
                                  label: t('components.templateShare.permission.editor'),
                                },
                              ]}
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                              onClick={() => toggleTeam(teamId)}
                              title={t('components.templateShare.removeTeam')}
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
                      placeholder={t('components.templateShare.addTeam')}
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

          {missing.length > 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <div className="mb-1 font-medium">
                  {t('components.templateShare.linkMissing.title')}
                </div>
                <ul className="space-y-0.5 text-tiny">
                  {missing.map((m, i) => (
                    <li key={`${m.resource}-${m.resource_id}-${i}`}>
                      {t('components.templateShare.linkMissing.line', {
                        resource: t(`components.templateShare.linkMissing.${m.resource}`),
                        name: m.resource_name,
                        scope:
                          m.scope.kind === 'public'
                            ? t('components.templateShare.linkMissing.scopePublic')
                            : t('components.templateShare.linkMissing.scopeTeam', {
                                team: m.scope.team_name,
                              }),
                      })}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {error && missing.length === 0 && <div className="text-xs text-destructive">{error}</div>}

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
