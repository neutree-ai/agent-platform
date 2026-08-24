import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import type { AutoScaling } from '@/lib/api/types'
import { useTranslation } from 'react-i18next'

/**
 * What a workspace gets when the user turns auto-scaling on without tuning it:
 * one warm replica, room to triple, and a workspace that stops itself after
 * five idle minutes (the next turn brings it straight back).
 */
export const AUTO_SCALING_DEFAULTS: AutoScaling = {
  min_replicas: 1,
  max_replicas: 3,
  scale_to_zero_idle_seconds: 300,
}

/** Idle timeout offered when the user switches scale-to-zero back on. */
const IDLE_SECONDS_FALLBACK = 300

function toCount(raw: string, fallback: number): number {
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

/**
 * The replica bounds of an auto-scaling workspace. Shared by the create dialog
 * (where the block decides the workspace's runtime shape) and the settings
 * panel (where only the numbers can still move).
 */
export function ScalingFields({
  value,
  onChange,
  disabled,
}: {
  value: AutoScaling
  onChange: (value: AutoScaling) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const scaleToZero = value.scale_to_zero_idle_seconds !== null

  return (
    <div className="grid gap-3 text-xs">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">{t('components.scalingFields.labels.minReplicas')}</Label>
          <Input
            className="h-8 text-xs"
            type="number"
            min={0}
            max={value.max_replicas}
            value={value.min_replicas}
            disabled={disabled}
            onChange={(e) =>
              onChange({ ...value, min_replicas: toCount(e.target.value, value.min_replicas) })
            }
          />
          <p className="text-mini text-muted-foreground">
            {t('components.scalingFields.hints.minReplicas')}
          </p>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t('components.scalingFields.labels.maxReplicas')}</Label>
          <Input
            className="h-8 text-xs"
            type="number"
            min={Math.max(value.min_replicas, 1)}
            value={value.max_replicas}
            disabled={disabled}
            onChange={(e) =>
              onChange({ ...value, max_replicas: toCount(e.target.value, value.max_replicas) })
            }
          />
          <p className="text-mini text-muted-foreground">
            {t('components.scalingFields.hints.maxReplicas')}
          </p>
        </div>
      </div>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium text-foreground">
            {t('components.scalingFields.scaleToZero.label')}
          </div>
          <p className="mt-1 text-mini text-muted-foreground">
            {t('components.scalingFields.scaleToZero.description')}
          </p>
        </div>
        <Switch
          checked={scaleToZero}
          disabled={disabled}
          className="mt-0.5 shrink-0"
          onCheckedChange={(on) =>
            onChange({ ...value, scale_to_zero_idle_seconds: on ? IDLE_SECONDS_FALLBACK : null })
          }
        />
      </div>

      {scaleToZero && (
        <div className="space-y-1">
          <Label className="text-xs">{t('components.scalingFields.labels.idleSeconds')}</Label>
          <Input
            className="h-8 text-xs"
            type="number"
            min={1}
            value={value.scale_to_zero_idle_seconds ?? IDLE_SECONDS_FALLBACK}
            disabled={disabled}
            onChange={(e) =>
              onChange({
                ...value,
                scale_to_zero_idle_seconds: Math.max(
                  1,
                  toCount(
                    e.target.value,
                    value.scale_to_zero_idle_seconds ?? IDLE_SECONDS_FALLBACK,
                  ),
                ),
              })
            }
          />
        </div>
      )}
    </div>
  )
}

/** Whether the bounds are consistent enough to send. */
export function scalingIsValid(v: AutoScaling): boolean {
  return v.max_replicas >= 1 && v.min_replicas <= v.max_replicas
}
