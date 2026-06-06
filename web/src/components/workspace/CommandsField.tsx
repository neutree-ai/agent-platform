import { Button } from '@/components/ui/button'
import { CommandFields } from '@/components/workspace/CommandFields'
import { Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TemplateCommandInput } from './ConfigFormFields'

/**
 * Controlled list editor for a template version's slash commands. Each row
 * reuses the shared `CommandFields` group (same as the single-command dialog).
 * Pure value in/out — the parent form submits the array with the version.
 */
export function CommandsField({
  value,
  onChange,
}: {
  value: TemplateCommandInput[]
  onChange: (value: TemplateCommandInput[]) => void
}) {
  const { t } = useTranslation()
  const update = (i: number, patch: Partial<TemplateCommandInput>) =>
    onChange(value.map((c, idx) => (idx === i ? { ...c, ...patch } : c)))
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i))
  const add = () => onChange([...value, { name: '', type: 'plain', prompt_id: null, content: '' }])

  return (
    <div className="space-y-2">
      {value.map((cmd, i) => (
        <div key={i} className="space-y-2 rounded-lg border border-border p-3">
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
          <CommandFields
            idPrefix={`tplcmd-${i}`}
            value={cmd}
            onChange={(patch) => update(i, patch)}
          />
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={add}>
        <Plus className="mr-1 h-3 w-3" />
        {t('components.automation.actions.newCommand')}
      </Button>
    </div>
  )
}
