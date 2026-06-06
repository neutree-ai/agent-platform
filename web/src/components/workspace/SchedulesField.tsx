import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ScheduleFields } from '@/components/workspace/ScheduleFields'
import { Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TemplateScheduleInput } from './ConfigFormFields'

/**
 * Controlled list editor for a template version's schedules. Each row reuses
 * the shared `ScheduleFields` group (recurring-only — template schedules can't
 * be one-time) plus an `enabled_default` toggle that's specific to templates.
 */
export function SchedulesField({
  value,
  onChange,
}: {
  value: TemplateScheduleInput[]
  onChange: (value: TemplateScheduleInput[]) => void
}) {
  const { t } = useTranslation()
  const update = (i: number, patch: Partial<TemplateScheduleInput>) =>
    onChange(value.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i))
  const add = () =>
    onChange([
      ...value,
      {
        name: '',
        cron: '0 9 * * *',
        timezone: 'UTC',
        prompt: '',
        prompt_id: null,
        enabled_default: false,
      },
    ])

  return (
    <div className="space-y-2">
      {value.map((s, i) => (
        <div key={i} className="space-y-3 rounded-lg border border-border p-3">
          <div className="flex justify-end">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={() => remove(i)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
          <ScheduleFields
            idPrefix={`tplsched-${i}`}
            mode="recurring"
            value={{
              name: s.name,
              cron: s.cron,
              run_at: '',
              timezone: s.timezone,
              prompt: s.prompt,
              prompt_id: s.prompt_id,
            }}
            onChange={(patch) =>
              update(i, {
                ...(patch.name !== undefined ? { name: patch.name } : {}),
                ...(patch.cron !== undefined ? { cron: patch.cron } : {}),
                ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}),
                ...(patch.prompt !== undefined ? { prompt: patch.prompt } : {}),
                ...(patch.prompt_id !== undefined ? { prompt_id: patch.prompt_id } : {}),
              })
            }
          />
          <Label className="flex items-center gap-2 text-muted-foreground text-xs">
            <Switch
              checked={s.enabled_default}
              onCheckedChange={(c) => update(i, { enabled_default: c })}
              className="scale-75"
            />
            {t('components.automation.fields.enabledDefault')}
          </Label>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={add}>
        <Plus className="mr-1 h-3 w-3" />
        {t('components.automation.actions.newSchedule')}
      </Button>
    </div>
  )
}
