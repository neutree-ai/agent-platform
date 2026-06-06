import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { AlertTriangle, GitBranch, Pencil } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ModelFields } from '../ModelFields'

interface ModelSectionProps {
  agentType: string
  providerId: string
  model: string
  smallModel: string
  originalAgentType: string
  onChange: (patch: {
    agentType?: string
    providerId?: string
    model?: string
    smallModel?: string
  }) => void
  onRevert?: (fields: string[]) => void
  templateConfig?: {
    agent_type?: string
    provider_id: string | null
    model: string
    small_model: string
  } | null
}

function normalize(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v)
}

export function ModelSection({
  agentType,
  providerId,
  model,
  smallModel,
  originalAgentType,
  onChange,
  onRevert,
  templateConfig,
}: ModelSectionProps) {
  const { t } = useTranslation()
  const agentTypeChanged = agentType !== originalAgentType

  // Compute which fields are overridden vs inherited
  const overridden: { label: string; fields: string[] }[] = []
  if (templateConfig) {
    if (
      templateConfig.agent_type !== undefined &&
      normalize(agentType) !== normalize(templateConfig.agent_type)
    ) {
      overridden.push({
        label: t('components.modelFields.labels.agentType'),
        fields: ['agent_type'],
      })
    }
    if (
      templateConfig.provider_id !== undefined &&
      normalize(providerId || null) !== normalize(templateConfig.provider_id)
    ) {
      overridden.push({
        label: t('components.modelFields.labels.provider'),
        fields: ['provider_id'],
      })
    }
    if (normalize(model) !== normalize(templateConfig.model)) {
      overridden.push({ label: t('components.modelFields.labels.model'), fields: ['model'] })
    }
    if (normalize(smallModel) !== normalize(templateConfig.small_model)) {
      overridden.push({
        label: t('components.modelFields.labels.smallModel'),
        fields: ['small_model'],
      })
    }
  }

  return (
    <div className="space-y-3">
      <ModelFields
        agentType={agentType}
        providerId={providerId}
        model={model}
        smallModel={smallModel}
        onChange={onChange}
      />
      {agentTypeChanged && (
        <Alert
          variant="destructive"
          className="flex items-start gap-2.5 p-3 [&>svg]:static [&>svg]:translate-y-0 [&>svg~*]:pl-0"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <AlertDescription className="space-y-1 text-xs">
            <p className="font-medium">
              {t('components.modelSection.warnings.agentTypeChanged.title')}
            </p>
            <ul className="list-disc space-y-0.5 pl-4 text-destructive/85">
              <li>{t('components.modelSection.warnings.agentTypeChanged.restart')}</li>
              <li>{t('components.modelSection.warnings.agentTypeChanged.sessionHistory')}</li>
            </ul>
          </AlertDescription>
        </Alert>
      )}
      {templateConfig &&
        (overridden.length === 0 ? (
          <Badge
            variant="outline"
            className="h-5 gap-1 px-1.5 text-mini border-success/30 bg-success/10 text-success cursor-default"
          >
            <GitBranch className="h-3 w-3" />
            {t('components.agentConfigFieldHint.inherited')}
          </Badge>
        ) : (
          <div className="flex flex-wrap gap-1">
            {overridden.map((item) => (
              <Badge
                key={item.label}
                variant="outline"
                className="h-5 gap-1 px-1.5 text-mini border-warning/30 bg-warning/10 text-warning cursor-pointer"
                onClick={() => onRevert?.(item.fields)}
              >
                <Pencil className="h-3 w-3" />
                {t('components.modelSection.actions.revertField', { label: item.label })}
              </Badge>
            ))}
          </div>
        ))}
    </div>
  )
}
