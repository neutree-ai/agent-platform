import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { useAuth } from '@/contexts/AuthContext'
import { api } from '@/lib/api/client'
import type { ApiTeam, EnvironmentVisibility } from '@/lib/api/types'
import { useQuery } from '@tanstack/react-query'
import { Lock, Users, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

export interface EnvironmentForm {
  name: string
  visibility: EnvironmentVisibility
  /** Set of team_ids the environment is shared with. Permission is always 'viewer'. */
  team_ids: string[]
}

export type EnvironmentFormErrors = Partial<{
  name: string
  teams: string
}>

interface EnvironmentFormFieldsProps {
  form: EnvironmentForm
  setForm: (next: (prev: EnvironmentForm) => EnvironmentForm) => void
  errors?: EnvironmentFormErrors
}

export function EnvironmentFormFields({ form, setForm, errors }: EnvironmentFormFieldsProps) {
  const { t } = useTranslation()
  const { user } = useAuth()
  // A public environment shares infrastructure instance-wide, so creating one is
  // an operator decision — admin-only (enforced server-side; hidden here so
  // non-admins don't pick an option that would 403). Still surface the option
  // when editing an already-public env so its current value renders correctly.
  const canPublish = user?.role === 'admin' || form.visibility === 'public'

  const { data: teams = [] } = useQuery<ApiTeam[]>({
    queryKey: ['teams'],
    queryFn: () => api.listTeams(),
  })

  function toggleTeam(id: string) {
    setForm((f) => {
      const has = f.team_ids.includes(id)
      return { ...f, team_ids: has ? f.team_ids.filter((x) => x !== id) : [...f.team_ids, id] }
    })
  }

  return (
    <div className="space-y-4">
      <Field
        label={t('components.environmentForm.fields.name')}
        error={errors?.name}
        htmlFor="environment-name"
      >
        <Input
          id="environment-name"
          className="h-9 text-sm"
          placeholder={t('components.environmentForm.placeholders.name')}
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        />
      </Field>

      <div className="space-y-3 rounded-md border border-border/60 bg-muted/30 p-3">
        <div className="flex flex-col gap-1.5">
          <Label className="block text-xs">
            {t('components.environmentForm.fields.visibility')}
          </Label>
          <SegmentedControl<EnvironmentVisibility>
            variant="box"
            size="md"
            value={form.visibility}
            onValueChange={(v) => setForm((f) => ({ ...f, visibility: v }))}
            options={[
              {
                value: 'private',
                label: t('components.environmentForm.visibility.private'),
                icon: Lock,
              },
              {
                value: 'team',
                label: t('components.environmentForm.visibility.team'),
                icon: Users,
              },
              ...(canPublish
                ? [
                    {
                      value: 'public' as const,
                      label: t('components.environmentForm.visibility.public'),
                    },
                  ]
                : []),
            ]}
          />
          <div className="text-tiny text-muted-foreground">
            {t(`components.environmentForm.visibilityDesc.${form.visibility}`)}
          </div>
        </div>

        {form.visibility === 'team' && (
          <div className="flex flex-col gap-1.5">
            <Label className="block text-tiny text-muted-foreground">
              {t('components.environmentForm.fields.teams')}
            </Label>
            {teams.length === 0 ? (
              <div className="text-tiny text-muted-foreground">
                {t('components.environmentForm.teamsEmpty')}
              </div>
            ) : (
              <>
                {form.team_ids.length === 0 ? (
                  <div className="text-tiny text-muted-foreground/70">
                    {t('components.environmentForm.noTeamsShared')}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {form.team_ids.map((teamId) => {
                      const team = teams.find((x) => x.id === teamId)
                      return (
                        <div
                          key={teamId}
                          className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-card px-2.5 py-1.5"
                        >
                          <span className="min-w-0 flex-1 truncate text-xs">
                            {team?.name ?? teamId}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                            onClick={() => toggleTeam(teamId)}
                            title={t('components.environmentForm.removeTeam')}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      )
                    })}
                  </div>
                )}
                {teams.some((tm) => !form.team_ids.includes(tm.id)) && (
                  <Combobox
                    placeholder={t('components.environmentForm.addTeam')}
                    value=""
                    onValueChange={(id) => id && toggleTeam(id)}
                    options={teams
                      .filter((tm) => !form.team_ids.includes(tm.id))
                      .map((tm) => ({ value: tm.id, label: tm.name }))}
                  />
                )}
              </>
            )}
            {errors?.teams && <div className="text-xs text-destructive">{errors.teams}</div>}
          </div>
        )}
      </div>
    </div>
  )
}

function Field({
  label,
  error,
  htmlFor,
  children,
}: {
  label: string
  error?: string
  htmlFor?: string
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </Label>
      {children}
      {error && <div className="text-xs text-destructive">{error}</div>}
    </div>
  )
}

/** Validation shared by create + edit. Returns errors keyed by field. */
export function validateEnvironmentForm(form: EnvironmentForm): EnvironmentFormErrors {
  const errors: EnvironmentFormErrors = {}
  if (!form.name.trim()) errors.name = 'components.environmentForm.errors.nameRequired'
  if (form.visibility === 'team' && form.team_ids.length === 0) {
    errors.teams = 'components.environmentForm.errors.teamRequired'
  }
  return errors
}
