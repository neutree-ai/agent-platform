import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ResourceFields } from '@/components/workspace/ConfigResourcesButton'
import { ScalingFields } from '@/components/workspace/ScalingFields'
import type { AutoScaling, ComputeResources } from '@/lib/api/types'
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
  /** Replica bounds when the workspace is auto-scaling; null when it is static. */
  autoScaling: AutoScaling | null
  onAutoScalingChange: (value: AutoScaling) => void
  maxConcurrency: number
  onMaxConcurrencyChange: (value: number) => void
  /** Live replica counts, for an auto-scaling workspace that is up. */
  replicas?: { ready: number; desired: number } | null
}

export function ResourcesSection({
  resources,
  onChange,
  onPreset,
  onRevert,
  templateConfig,
  autoStart,
  onAutoStartChange,
  autoScaling,
  onAutoScalingChange,
  maxConcurrency,
  onMaxConcurrencyChange,
  replicas,
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

      <div className="mt-4 space-y-3 border-t border-border/60 pt-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs font-medium text-foreground">
            {t('components.settings.scaling.label')}
          </div>
          {autoScaling && replicas && (
            <span className="shrink-0 text-mini text-muted-foreground">
              {t('components.settings.scaling.replicasReady', {
                ready: replicas.ready,
                desired: replicas.desired,
              })}
            </span>
          )}
        </div>

        <div className="space-y-1 text-xs">
          <Label className="text-xs">{t('components.settings.scaling.concurrency.label')}</Label>
          <Input
            className="h-8 text-xs"
            type="number"
            min={1}
            value={maxConcurrency}
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10)
              onMaxConcurrencyChange(Number.isFinite(n) && n >= 1 ? n : maxConcurrency)
            }}
          />
          <p className="text-mini text-muted-foreground">
            {autoScaling
              ? t('components.settings.scaling.concurrency.hintAutoScaling')
              : t('components.settings.scaling.concurrency.hintStatic')}
          </p>
        </div>

        {autoScaling ? (
          <ScalingFields value={autoScaling} onChange={onAutoScalingChange} />
        ) : (
          // Turning auto-scaling on would mean swapping the workload and the
          // volume mode under a live workspace, so it stays a create-time choice.
          <p className="text-mini text-muted-foreground">
            {t('components.settings.scaling.staticNote')}
          </p>
        )}
      </div>

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
