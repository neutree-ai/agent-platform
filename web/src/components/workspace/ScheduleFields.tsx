import { CronEditor } from '@/components/ui/cron-editor'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TimezoneSelect } from '@/components/ui/timezone-select'
import { PromptField } from '@/components/workspace/PromptField'
import { useTranslation } from 'react-i18next'

export type ScheduleMode = 'recurring' | 'one_time'

export function detectScheduleMode(schedule: { run_at?: string | null } | undefined): ScheduleMode {
  return schedule?.run_at ? 'one_time' : 'recurring'
}

/** Format a Date as a `<input type="datetime-local">` value (local wall-clock). */
export function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function defaultRunAt(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000) // +1h
  d.setSeconds(0, 0)
  return toDatetimeLocal(d)
}

interface ScheduleFieldsValue {
  name: string
  cron: string
  /** datetime-local string (only used in one-time mode). */
  run_at: string
  timezone: string
  prompt: string
  prompt_id: string | null
}

/**
 * Controlled field group for a single schedule. Shared by the schedule dialog
 * (`ScheduleForm`, both modes) and the template version's schedule list editor
 * (`SchedulesField`, recurring-only). Omit `onModeChange` to hide the mode tabs.
 */
export function ScheduleFields({
  value,
  onChange,
  mode,
  onModeChange,
  modeDisabled,
  idPrefix = 'schedule',
}: {
  value: ScheduleFieldsValue
  onChange: (patch: Partial<ScheduleFieldsValue>) => void
  mode: ScheduleMode
  onModeChange?: (m: ScheduleMode) => void
  modeDisabled?: boolean
  idPrefix?: string
}) {
  const { t } = useTranslation()

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}_name`}>{t('components.configSchedules.form.name')}</Label>
        <Input
          id={`${idPrefix}_name`}
          value={value.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder={t('components.configSchedules.form.placeholders.name')}
          required
        />
      </div>

      {onModeChange && (
        <div className="space-y-2">
          <Label>{t('components.configSchedules.form.mode')}</Label>
          <Tabs value={mode} onValueChange={(v) => onModeChange(v as ScheduleMode)}>
            <TabsList className="h-8 w-full">
              <TabsTrigger value="recurring" className="flex-1 text-xs" disabled={modeDisabled}>
                {t('components.configSchedules.form.modeRecurring')}
              </TabsTrigger>
              <TabsTrigger value="one_time" className="flex-1 text-xs" disabled={modeDisabled}>
                {t('components.configSchedules.form.modeOneTime')}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      )}

      {mode === 'recurring' ? (
        <div className="space-y-2">
          <Label>{t('components.configSchedules.form.schedule')}</Label>
          <CronEditor
            value={value.cron}
            onChange={(cron) => onChange({ cron })}
            timezone={value.timezone}
          />
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}_run_at`}>{t('components.configSchedules.form.runAt')}</Label>
          <Input
            id={`${idPrefix}_run_at`}
            type="datetime-local"
            value={value.run_at}
            onChange={(e) => onChange({ run_at: e.target.value })}
            required
          />
        </div>
      )}

      <div className="space-y-2">
        <Label>{t('components.configSchedules.form.timezone')}</Label>
        <TimezoneSelect value={value.timezone} onChange={(timezone) => onChange({ timezone })} />
      </div>

      <PromptField
        label={t('components.configSchedules.form.prompt')}
        promptId={value.prompt_id}
        content={value.prompt}
        onChange={(patch) =>
          onChange({
            ...(patch.promptId !== undefined ? { prompt_id: patch.promptId } : {}),
            ...(patch.content !== undefined ? { prompt: patch.content } : {}),
          })
        }
        placeholder={t('components.configSchedules.form.placeholders.prompt')}
        previewMaxHeight="200px"
      />
    </div>
  )
}
