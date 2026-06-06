import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ComputeResources } from '@/lib/api/types'
import { useTranslation } from 'react-i18next'

export const RESOURCE_PRESETS = [
  {
    key: 'small',
    label: 'S',
    description: '0.5 CPU / 1Gi',
    values: {
      cpu_request: '100m',
      cpu_limit: '500m',
      memory_request: '256Mi',
      memory_limit: '1Gi',
      storage: '10Gi',
    },
  },
  {
    key: 'medium',
    label: 'M',
    description: '1 CPU / 2Gi',
    values: {
      cpu_request: '250m',
      cpu_limit: '1000m',
      memory_request: '512Mi',
      memory_limit: '2Gi',
      storage: '20Gi',
    },
  },
  {
    key: 'large',
    label: 'L',
    description: '4 CPU / 8Gi',
    values: {
      cpu_request: '1000m',
      cpu_limit: '4000m',
      memory_request: '2Gi',
      memory_limit: '8Gi',
      storage: '50Gi',
    },
  },
] as const

export const DEFAULTS = RESOURCE_PRESETS[0].values

/** Find which preset matches the current resources, if any. */
function matchPreset(r: ComputeResources): string | null {
  for (const p of RESOURCE_PRESETS) {
    const v = p.values
    if (
      r.cpu_request === v.cpu_request &&
      r.cpu_limit === v.cpu_limit &&
      r.memory_request === v.memory_request &&
      r.memory_limit === v.memory_limit &&
      r.storage === v.storage
    ) {
      return p.key
    }
  }
  return null
}

/** Shared resource input fields, used by both edit dialog and create form. */
export function ResourceFields({
  resources,
  onChange,
  onPreset,
  hint,
}: {
  resources: ComputeResources
  onChange: (field: keyof ComputeResources, value: string) => void
  onPreset: (values: Required<ComputeResources>) => void
  hint?: string | null
}) {
  const { t } = useTranslation()
  const activePreset = matchPreset(resources)

  return (
    <div className="grid gap-3 text-xs">
      {hint !== null && (
        <p className="text-muted-foreground">{hint ?? t('components.resourceFields.hint')}</p>
      )}
      <div className="flex gap-2">
        {RESOURCE_PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => onPreset({ ...p.values })}
            className={`flex-1 rounded-md border px-3 py-1.5 text-center transition-colors ${
              activePreset === p.key
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:border-primary/50'
            }`}
          >
            <div className="font-medium">{p.label}</div>
            <div className="text-mini opacity-70">{p.description}</div>
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">{t('components.resourceFields.labels.cpuRequest')}</Label>
          <Input
            className="h-8 text-xs"
            value={resources.cpu_request ?? ''}
            onChange={(e) => onChange('cpu_request', e.target.value)}
            placeholder={DEFAULTS.cpu_request}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t('components.resourceFields.labels.cpuLimit')}</Label>
          <Input
            className="h-8 text-xs"
            value={resources.cpu_limit ?? ''}
            onChange={(e) => onChange('cpu_limit', e.target.value)}
            placeholder={DEFAULTS.cpu_limit}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">{t('components.resourceFields.labels.memoryRequest')}</Label>
          <Input
            className="h-8 text-xs"
            value={resources.memory_request ?? ''}
            onChange={(e) => onChange('memory_request', e.target.value)}
            placeholder={DEFAULTS.memory_request}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t('components.resourceFields.labels.memoryLimit')}</Label>
          <Input
            className="h-8 text-xs"
            value={resources.memory_limit ?? ''}
            onChange={(e) => onChange('memory_limit', e.target.value)}
            placeholder={DEFAULTS.memory_limit}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">{t('components.resourceFields.labels.storage')}</Label>
        <Input
          className="h-8 text-xs"
          value={resources.storage ?? ''}
          onChange={(e) => onChange('storage', e.target.value)}
          placeholder={DEFAULTS.storage}
        />
      </div>
    </div>
  )
}
