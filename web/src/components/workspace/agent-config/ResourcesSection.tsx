import { Switch } from '@/components/ui/switch'
import { ResourceFields } from '@/components/workspace/ConfigResourcesButton'
import type { ComputeResources } from '@/lib/api/types'
import { useTranslation } from 'react-i18next'
import { FieldHint, resourcesEqual } from './FieldHint'

interface ResourcesSectionProps {
  resources: ComputeResources
  onChange: (field: keyof ComputeResources, value: string) => void
  onPreset: (values: Required<ComputeResources>) => void
  onRevert?: () => void
  templateConfig?: { compute_resources: ComputeResources } | null
  autoStart: boolean
  onAutoStartChange: (value: boolean) => void
}

export function ResourcesSection({
  resources,
  onChange,
  onPreset,
  onRevert,
  templateConfig,
  autoStart,
  onAutoStartChange,
}: ResourcesSectionProps) {
  const { t } = useTranslation()
  return (
    <div className="space-y-3">
      <ResourceFields resources={resources} onChange={onChange} onPreset={onPreset} />
      <FieldHint
        current={resources}
        template={templateConfig?.compute_resources}
        onRevert={() => onRevert?.()}
        compare={resourcesEqual}
      />
      <div className="mt-4 flex items-start justify-between gap-3 border-t border-border/60 pt-4">
        <div className="min-w-0">
          <div className="text-xs font-medium text-foreground">
            {t('components.settings.autoStart.label')}
          </div>
          <p className="mt-1 text-mini text-muted-foreground">
            {t('components.settings.autoStart.description')}
          </p>
        </div>
        <Switch
          checked={autoStart}
          onCheckedChange={onAutoStartChange}
          className="mt-0.5 shrink-0"
        />
      </div>
    </div>
  )
}
