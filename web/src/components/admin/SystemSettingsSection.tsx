import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api/client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card } from '@tremor/react'
import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 pt-4 first:pt-0">
      <h2 className="shrink-0 text-sm font-medium text-foreground">{children}</h2>
      <div className="h-px flex-1 bg-border" />
    </div>
  )
}

type UpdatePatch = Parameters<typeof api.updateSystemSettings>[0]

// One provider-registry feature (ASR, title-gen, …): an active-provider select
// plus a JSON config editor. Owns its own local form state and save, and PUTs
// only its own slice via `buildPatch` so features stay independent.
function ProviderConfigCard(props: {
  labelPrefix: string
  activeProvider: string | null
  providers: Record<string, unknown>
  available: string[]
  buildPatch: (activeProvider: string | null, providers: Record<string, unknown>) => UpdatePatch
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const fieldId = useId()

  const [activeProvider, setActiveProvider] = useState<string>('')
  const [providersJson, setProvidersJson] = useState<string>('')
  const [jsonError, setJsonError] = useState<string | null>(null)

  // Hydrate local form state whenever the upstream query data changes.
  useEffect(() => {
    setActiveProvider(props.activeProvider ?? '')
    setProvidersJson(JSON.stringify(props.providers ?? {}, null, 2))
  }, [props.activeProvider, props.providers])

  const save = useMutation({
    mutationFn: async () => {
      let parsed: Record<string, unknown> = {}
      try {
        parsed = providersJson.trim() ? JSON.parse(providersJson) : {}
      } catch (e) {
        throw new Error(`Invalid JSON: ${(e as Error).message}`)
      }
      return api.updateSystemSettings(props.buildPatch(activeProvider || null, parsed))
    },
    onSuccess: () => {
      setJsonError(null)
      qc.invalidateQueries({ queryKey: ['admin', 'system-settings'] })
    },
    onError: (e: Error) => {
      setJsonError(e.message)
    },
  })

  const tp = (key: string) =>
    t(`components.admin.systemSettingsSection.${props.labelPrefix}.${key}`)
  const noProviders = props.available.length === 0

  return (
    <Card className="!bg-card !ring-border !p-4">
      <p className="text-xs text-muted-foreground">{tp('description')}</p>

      {noProviders && (
        <Alert className="mt-3">
          <AlertDescription className="text-xs">{tp('noProviders')}</AlertDescription>
        </Alert>
      )}

      <div className="mt-4 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor={`${fieldId}-active`} className="text-xs">
            {tp('activeProvider')}
          </Label>
          <select
            id={`${fieldId}-active`}
            value={activeProvider}
            onChange={(e) => setActiveProvider(e.target.value)}
            disabled={noProviders}
            className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-xs focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="">{tp('activeProviderNone')}</option>
            {props.available.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${fieldId}-json`} className="text-xs">
            {tp('providersConfig')}
          </Label>
          <Textarea
            id={`${fieldId}-json`}
            value={providersJson}
            onChange={(e) => setProvidersJson(e.target.value)}
            rows={12}
            className="font-mono text-xs"
            spellCheck={false}
          />
          <p className="text-tiny text-muted-foreground">{tp('providersConfigHint')}</p>
        </div>

        {jsonError && (
          <Alert variant="destructive">
            <AlertDescription className="text-xs">{jsonError}</AlertDescription>
          </Alert>
        )}

        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setActiveProvider(props.activeProvider ?? '')
              setProvidersJson(JSON.stringify(props.providers ?? {}, null, 2))
              setJsonError(null)
            }}
            disabled={save.isPending}
          >
            {t('components.admin.systemSettingsSection.actions.reset')}
          </Button>
          <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending
              ? t('components.admin.systemSettingsSection.actions.saving')
              : t('components.admin.systemSettingsSection.actions.save')}
          </Button>
        </div>
      </div>
    </Card>
  )
}

// instanceId reserved for future per-instance UI state — currently unused.
export function SystemSettingsSection(_: { instanceId: string }) {
  const { t } = useTranslation()

  const settings = useQuery({
    queryKey: ['admin', 'system-settings'],
    queryFn: () => api.getSystemSettings(),
  })

  if (settings.isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner />
      </div>
    )
  }

  if (settings.error || !settings.data) {
    return (
      <p className="py-8 text-center text-xs text-muted-foreground">
        {t('components.admin.systemSettingsSection.errors.loadFailed')}
      </p>
    )
  }

  const data = settings.data

  return (
    <div className="space-y-3 p-1">
      <SectionTitle>{t('components.admin.systemSettingsSection.sections.asr')}</SectionTitle>
      <ProviderConfigCard
        labelPrefix="asr"
        activeProvider={data.asr_active_provider}
        providers={data.asr_providers}
        available={data.asr_available_providers}
        buildPatch={(activeProvider, providers) => ({
          asr_active_provider: activeProvider,
          asr_providers: providers,
        })}
      />

      <SectionTitle>{t('components.admin.systemSettingsSection.sections.titlegen')}</SectionTitle>
      <ProviderConfigCard
        labelPrefix="titlegen"
        activeProvider={data.titlegen_active_provider}
        providers={data.titlegen_providers}
        available={data.titlegen_available_providers}
        buildPatch={(activeProvider, providers) => ({
          titlegen_active_provider: activeProvider,
          titlegen_providers: providers,
        })}
      />
    </div>
  )
}
