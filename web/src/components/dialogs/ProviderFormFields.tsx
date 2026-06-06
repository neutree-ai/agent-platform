import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SegmentedControl } from '@/components/ui/segmented-control'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api/client'
import type { ApiTeam, ProviderVisibility } from '@/lib/api/types'
import { cn } from '@/lib/utils'
import { useQuery } from '@tanstack/react-query'
import { Eye, EyeOff, Lock, Users, X } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface ProviderForm {
  name: string
  description: string
  provider_type: string
  base_url: string
  api_key: string
  visibility: ProviderVisibility
  /** Set of team_ids the provider is shared with. Permission is always 'viewer'. */
  team_ids: string[]
}

export type ProviderFormErrors = Partial<{
  name: string
  baseUrl: string
  apiKey: string
  teams: string
}>

interface ProviderFormFieldsProps {
  form: ProviderForm
  setForm: (next: (prev: ProviderForm) => ProviderForm) => void
  errors?: ProviderFormErrors
  /** Edit mode tweaks copy (API key may be left blank to keep existing). */
  isEditing?: boolean
}

const PROVIDER_TYPES: Array<{ value: string; labelKey: string; descKey: string }> = [
  {
    value: 'anthropic',
    labelKey: 'components.createProvider.types.anthropic.label',
    descKey: 'components.createProvider.types.anthropic.desc',
  },
  {
    value: 'anthropic-oauth',
    labelKey: 'components.createProvider.types.anthropicOauth.label',
    descKey: 'components.createProvider.types.anthropicOauth.desc',
  },
  {
    value: 'claude-code-oauth',
    labelKey: 'components.createProvider.types.claudeCodeOauth.label',
    descKey: 'components.createProvider.types.claudeCodeOauth.desc',
  },
  {
    value: 'openai',
    labelKey: 'components.createProvider.types.openai.label',
    descKey: 'components.createProvider.types.openai.desc',
  },
]

export function ProviderFormFields({ form, setForm, errors, isEditing }: ProviderFormFieldsProps) {
  const { t } = useTranslation()
  const [showKey, setShowKey] = useState(false)
  const isOauthOnly = form.provider_type === 'claude-code-oauth'

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
        label={t('components.createProvider.fields.name')}
        error={errors?.name}
        htmlFor="provider-name"
      >
        <Input
          id="provider-name"
          className="h-9 text-sm"
          placeholder={t('components.createProvider.placeholders.name')}
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        />
      </Field>

      <Field
        label={t('components.createProvider.fields.description')}
        htmlFor="provider-description"
      >
        <Textarea
          id="provider-description"
          className="min-h-[64px] resize-none text-sm"
          placeholder={t('components.createProvider.placeholders.description')}
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        />
      </Field>

      <Field label={t('components.createProvider.fields.type')} htmlFor="provider-type">
        <Select
          value={form.provider_type}
          onValueChange={(v) => setForm((f) => ({ ...f, provider_type: v }))}
        >
          <SelectTrigger id="provider-type" className="h-9 text-sm focus:ring-inset">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROVIDER_TYPES.map((p) => (
              <SelectItem key={p.value} value={p.value} className="py-2" description={t(p.descKey)}>
                {t(p.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {!isOauthOnly && (
        <Field
          label={t('components.createProvider.fields.baseUrl')}
          error={errors?.baseUrl}
          htmlFor="provider-base-url"
        >
          <Input
            id="provider-base-url"
            className="h-9 text-sm"
            value={form.base_url}
            onChange={(e) => setForm((f) => ({ ...f, base_url: e.target.value }))}
            placeholder={
              form.provider_type === 'anthropic' || form.provider_type === 'anthropic-oauth'
                ? t('components.createProvider.placeholders.anthropicBaseUrl')
                : t('components.createProvider.placeholders.openaiBaseUrl')
            }
          />
        </Field>
      )}

      <Field
        label={
          isEditing
            ? t('components.management.providers.fields.apiKey')
            : t('components.createProvider.fields.apiKey')
        }
        error={errors?.apiKey}
        htmlFor="provider-api-key"
      >
        <div className="relative">
          <Input
            id="provider-api-key"
            className="h-9 pr-9 text-sm"
            type={showKey ? 'text' : 'password'}
            value={form.api_key}
            onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))}
            placeholder={t('components.createProvider.placeholders.apiKey')}
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => setShowKey((s) => !s)}
            aria-label={t(
              showKey
                ? 'components.createProvider.actions.hideKey'
                : 'components.createProvider.actions.showKey',
            )}
            title={t(
              showKey
                ? 'components.createProvider.actions.hideKey'
                : 'components.createProvider.actions.showKey',
            )}
            className={cn(
              'absolute right-2 top-1/2 -translate-y-1/2',
              'flex h-6 w-6 items-center justify-center rounded',
              'text-muted-foreground/70 hover:text-foreground',
              'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25',
            )}
          >
            {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </Field>

      <div className="space-y-3 rounded-md border border-border/60 bg-muted/30 p-3">
        <div className="flex flex-col gap-1.5">
          <Label className="block text-xs">
            {t('components.createProvider.fields.visibility')}
          </Label>
          <SegmentedControl<ProviderVisibility>
            variant="box"
            size="md"
            value={form.visibility}
            onValueChange={(v) => setForm((f) => ({ ...f, visibility: v }))}
            options={[
              {
                value: 'private',
                label: t('components.createProvider.visibility.private'),
                icon: Lock,
              },
              {
                value: 'team',
                label: t('components.createProvider.visibility.team'),
                icon: Users,
              },
              {
                value: 'public',
                label: t('components.createProvider.visibility.public'),
              },
            ]}
          />
          <div className="text-tiny text-muted-foreground">
            {t(`components.createProvider.visibilityDesc.${form.visibility}`)}
          </div>
        </div>

        {form.visibility === 'team' && (
          <div className="flex flex-col gap-1.5">
            <Label className="block text-tiny text-muted-foreground">
              {t('components.createProvider.fields.teams')}
            </Label>
            {teams.length === 0 ? (
              <div className="text-tiny text-muted-foreground">
                {t('components.createProvider.teamsEmpty')}
              </div>
            ) : (
              <>
                {form.team_ids.length === 0 ? (
                  <div className="text-tiny text-muted-foreground/70">
                    {t('components.createProvider.noTeamsShared')}
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
                            title={t('components.createProvider.removeTeam')}
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
                    placeholder={t('components.createProvider.addTeam')}
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
export function validateProviderForm(
  form: ProviderForm,
  options: { isEditing: boolean },
): ProviderFormErrors {
  const errors: ProviderFormErrors = {}
  if (!form.name) errors.name = 'components.createProvider.errors.nameRequired'
  if (!form.base_url && form.provider_type !== 'claude-code-oauth') {
    errors.baseUrl = 'components.createProvider.errors.baseUrlRequired'
  }
  if (!options.isEditing && !form.api_key) {
    errors.apiKey = 'components.createProvider.errors.apiKeyRequired'
  }
  if (form.visibility === 'team' && form.team_ids.length === 0) {
    errors.teams = 'components.createProvider.errors.teamRequired'
  }
  return errors
}
