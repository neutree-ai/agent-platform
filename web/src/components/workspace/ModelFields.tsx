import { Combobox } from '@/components/ui/combobox'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { api } from '@/lib/api/client'
import type { ApiModelProvider } from '@/lib/api/types'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ModelInput,
  TestButton,
  TestResult,
  useProviderModels,
  useProviderTest,
} from './agent-config/ModelPicker'

const AGENT_TYPES = [
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'codex', label: 'Codex' },
]

/** Provider types each agent supports — omit to allow all. */
const AGENT_PROVIDER_TYPES: Record<string, string[] | null> = {
  'claude-code': ['anthropic', 'anthropic-oauth', 'claude-code-oauth'],
  opencode: null,
  codex: ['openai'],
}

// Compose a one-line attribution for non-owned providers so the workspace
// picker reveals where a shared/public provider came from. Owners keep the
// provider's own description (no attribution needed).
function providerSourceLabel(p: ApiModelProvider): string {
  if (p.is_owner) return ''
  const parts: string[] = []
  if (p.owner_name) parts.push(`@${p.owner_name}`)
  if (p.shared_via_teams.length > 0) {
    parts.push(p.shared_via_teams.map((tm) => tm.name).join(', '))
  } else if (p.visibility === 'public') {
    parts.push('public')
  }
  return parts.join(' · ')
}

interface ModelFieldsProps {
  agentType: string
  providerId: string
  model: string
  smallModel: string
  onChange: (patch: {
    agentType?: string
    providerId?: string
    model?: string
    smallModel?: string
  }) => void
}

export function ModelFields({
  agentType,
  providerId,
  model,
  smallModel,
  onChange,
}: ModelFieldsProps) {
  const { t } = useTranslation()
  const [providers, setProviders] = useState<ApiModelProvider[]>([])
  const { models, loading: modelsLoading, error: modelsError } = useProviderModels(providerId)
  const test = useProviderTest(providerId, model)

  useEffect(() => {
    api
      .listProviders()
      .then(setProviders)
      .catch(() => {})
  }, [])

  // Default small model to match main model whenever it's empty. The backend
  // already falls back to the main model when small model is empty, so this
  // just makes the default visible to the user.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (model && !smallModel) onChange({ smallModel: model })
  }, [model])

  const filteredProviders = providers.filter((p) => {
    const allowed = AGENT_PROVIDER_TYPES[agentType]
    return !allowed || allowed.includes(p.provider_type)
  })

  // If the selected provider's type isn't supported by the current agent type
  // (e.g. after switching codex → claude-code), clear it so we never persist a
  // provider the agent can't actually use. Wait until providers have loaded so
  // we don't clear a still-resolving selection.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!providerId) return
    const allowed = AGENT_PROVIDER_TYPES[agentType]
    if (!allowed) return
    const selected = providers.find((p) => p.id === providerId)
    if (selected && !allowed.includes(selected.provider_type)) {
      onChange({ providerId: '' })
    }
  }, [agentType, providerId, providers])

  return (
    <div className="space-y-3">
      {/* Agent Type */}
      <div className="space-y-1">
        <Label className="text-xs">{t('components.modelFields.labels.agentType')}</Label>
        <Select value={agentType} onValueChange={(v) => onChange({ agentType: v })}>
          <SelectTrigger className="h-7 text-xs focus:ring-inset">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AGENT_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Provider (full width) */}
      <div className="space-y-1">
        <Label className="text-xs">{t('components.modelFields.labels.provider')}</Label>
        <Combobox
          value={providerId}
          onValueChange={(v) => onChange({ providerId: v })}
          placeholder={t('components.modelFields.placeholders.provider')}
          searchPlaceholder={t('components.modelFields.placeholders.searchProviders')}
          emptyText={t('components.modelFields.empty.noProviders')}
          allowNone
          options={filteredProviders.map((p) => ({
            value: p.id,
            label: p.name,
            description: providerSourceLabel(p) || p.description,
          }))}
        />
      </div>

      {/* Model */}
      <div className="space-y-1">
        <Label className="text-xs">{t('components.modelFields.labels.model')}</Label>
        <div className="flex items-center gap-1">
          <ModelInput
            value={model}
            onChange={(v) => onChange({ model: v })}
            providerId={providerId}
            models={models}
            modelsLoading={modelsLoading}
            placeholder={t('components.modelFields.placeholders.model')}
            className="h-7"
          />
          {providerId && (
            <TestButton
              providerId={providerId}
              state={test.state}
              onRun={test.run}
              className="shrink-0"
            />
          )}
        </div>
        {modelsError && (
          <p className="text-xs text-destructive">{modelsError}</p>
        )}
        {providerId && <TestResult state={test.state} detail={test.detail} />}
      </div>

      {/* Small Model */}
      <div className="space-y-1">
        <Label className="text-xs">{t('components.modelFields.labels.smallModel')}</Label>
        <ModelInput
          value={smallModel}
          onChange={(v) => onChange({ smallModel: v })}
          providerId={providerId}
          models={models}
          modelsLoading={modelsLoading}
          placeholder={t('components.modelFields.placeholders.smallModel')}
          className="h-7"
        />
      </div>
    </div>
  )
}
