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
import type { ApiModelProvider, ApiTeam, ModelProfile, ProviderVisibility } from '@/lib/api/types'
import { catalogToText, parseCatalogText } from '@/lib/model-profile'
import { cn } from '@/lib/utils'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Eye, EyeOff, Lock, Upload, Users, X } from 'lucide-react'
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
  /**
   * The stored profile, carried through untouched. The form edits two of its
   * fields below and folds them back in on save, so keys this build knows
   * nothing about are not dropped by someone editing an unrelated setting.
   */
  model_profile: ModelProfile | null
  /** codex.model_catalog as editable JSON text; '' declares no catalog. */
  catalog_text: string
  /** codex.reasoning_effort; '' leaves it to codex. */
  reasoning_effort: string
}

export type ProviderFormErrors = Partial<{
  name: string
  baseUrl: string
  apiKey: string
  teams: string
  catalog: string
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
  {
    value: 'openai-chat',
    labelKey: 'components.createProvider.types.openaiChat.label',
    descKey: 'components.createProvider.types.openaiChat.desc',
  },
]

export function ProviderFormFields({ form, setForm, errors, isEditing }: ProviderFormFieldsProps) {
  const { t } = useTranslation()
  const [showKey, setShowKey] = useState(false)
  const isOauthOnly = form.provider_type === 'claude-code-oauth'
  // The profile only carries codex keys today, and codex only speaks to the
  // OpenAI-shaped types — offering the section elsewhere would promise an
  // effect the agent never applies.
  const isCodexCapable = form.provider_type === 'openai' || form.provider_type === 'openai-chat'

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

      {isCodexCapable && (
        <ModelDeclarationSection form={form} setForm={setForm} error={errors?.catalog} />
      )}

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

const REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

/**
 * The provider's declaration about the models it serves.
 *
 * Collapsed by default and worded as an escape hatch: most providers serve
 * models codex already knows, and the catalog is a large document nobody
 * writes by hand — it comes from the model vendor, which is why loading a file
 * and copying another provider's are the two first-class ways in.
 */
function ModelDeclarationSection({
  form,
  setForm,
  error,
}: {
  form: ProviderForm
  setForm: (next: (prev: ProviderForm) => ProviderForm) => void
  error?: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const parsed = parseCatalogText(form.catalog_text)

  const { data: providers = [] } = useQuery<ApiModelProvider[]>({
    queryKey: ['providers'],
    queryFn: () => api.listProviders(),
    enabled: open,
  })
  const donors = providers.filter((p) => p.model_profile?.codex?.model_catalog)

  function loadFile(file: File | undefined) {
    if (!file) return
    file.text().then((text) => setForm((f) => ({ ...f, catalog_text: text.trim() })))
  }

  const summary = parsed.slugs.length
    ? t('components.createProvider.modelDeclaration.covers', { models: parsed.slugs.join(', ') })
    : t('components.createProvider.modelDeclaration.empty')

  return (
    <div className="rounded-md border border-border/60 bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
      >
        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 text-muted-foreground transition-transform',
            open && 'rotate-90',
          )}
        />
        <span className="text-xs font-medium">
          {t('components.createProvider.modelDeclaration.title')}
        </span>
        <span className="ml-auto truncate text-tiny text-muted-foreground">{summary}</span>
      </button>

      {open && (
        <div className="space-y-2.5 border-t border-border/60 p-3">
          <p className="text-tiny text-muted-foreground">
            {t('components.createProvider.modelDeclaration.help')}
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-tiny"
              asChild
            >
              <label>
                <Upload className="h-3 w-3" />
                {t('components.createProvider.modelDeclaration.loadFile')}
                <input
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(e) => loadFile(e.target.files?.[0])}
                />
              </label>
            </Button>
            {donors.length > 0 && (
              <Combobox
                placeholder={t('components.createProvider.modelDeclaration.copyFrom')}
                value=""
                onValueChange={(id) => {
                  const donor = donors.find((p) => p.id === id)
                  if (!donor) return
                  setForm((f) => ({
                    ...f,
                    catalog_text: catalogToText(donor.model_profile),
                    reasoning_effort:
                      donor.model_profile?.codex?.reasoning_effort ?? f.reasoning_effort,
                  }))
                }}
                options={donors.map((p) => ({ value: p.id, label: p.name }))}
              />
            )}
            {form.catalog_text && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-tiny text-muted-foreground"
                onClick={() => setForm((f) => ({ ...f, catalog_text: '' }))}
              >
                {t('components.createProvider.modelDeclaration.clear')}
              </Button>
            )}
          </div>

          <Textarea
            className="min-h-[140px] font-mono text-tiny"
            spellCheck={false}
            placeholder={t('components.createProvider.modelDeclaration.placeholder')}
            value={form.catalog_text}
            onChange={(e) => setForm((f) => ({ ...f, catalog_text: e.target.value }))}
          />
          {(error || !parsed.ok) && (
            <div className="text-xs text-destructive">{error ?? parsed.error}</div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label className="block text-tiny text-muted-foreground">
              {t('components.createProvider.modelDeclaration.reasoningEffort')}
            </Label>
            <Select
              value={form.reasoning_effort || 'default'}
              onValueChange={(v) =>
                setForm((f) => ({ ...f, reasoning_effort: v === 'default' ? '' : v }))
              }
            >
              <SelectTrigger className="h-8 text-xs focus:ring-inset">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default" className="py-1.5">
                  {t('components.createProvider.modelDeclaration.effortDefault')}
                </SelectItem>
                {REASONING_EFFORTS.map((level) => (
                  <SelectItem key={level} value={level} className="py-1.5">
                    {level}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
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
  // A catalog codex cannot read stops it from starting at all, so a broken one
  // must not reach the store — the agent's fallback is a backstop, not a plan.
  if (!parseCatalogText(form.catalog_text).ok) {
    errors.catalog = 'components.createProvider.errors.catalogInvalid'
  }
  return errors
}
