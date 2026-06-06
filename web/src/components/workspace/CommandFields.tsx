import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { RESERVED_COMMAND_NAMES } from '@/components/workspace/CommandTrigger'
import { PromptField } from '@/components/workspace/PromptField'
import { useTranslation } from 'react-i18next'

interface CommandFieldsValue {
  name: string
  type: 'plain' | 'struct'
  prompt_id: string | null
  content: string
}

/**
 * Controlled field group for a single slash command (name / type / content).
 * Shared by the single-command dialog (`CommandForm`) and the template
 * version's command list editor (`CommandsField`) so the two stay in sync.
 */
export function CommandFields({
  value,
  onChange,
  idPrefix = 'cmd',
}: {
  value: CommandFieldsValue
  onChange: (patch: Partial<CommandFieldsValue>) => void
  /** Disambiguate input ids when multiple instances render on one page. */
  idPrefix?: string
}) {
  const { t } = useTranslation()
  const isReserved = RESERVED_COMMAND_NAMES.has(value.name.trim().toLowerCase())

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}_name`}>{t('components.configCommands.form.name')}</Label>
        <Input
          id={`${idPrefix}_name`}
          value={value.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder={t('components.configCommands.form.placeholders.name')}
          required
        />
        {isReserved && (
          <p className="text-tiny text-destructive">
            {t('components.configCommands.form.reservedName', { name: value.name.trim() })}
          </p>
        )}
      </div>
      <div className="space-y-2">
        <Label>{t('components.configCommands.form.type')}</Label>
        <Select
          value={value.type}
          onValueChange={(v) => onChange({ type: v as 'plain' | 'struct' })}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="plain">{t('components.configCommands.types.plain')}</SelectItem>
            <SelectItem value="struct">{t('components.configCommands.types.struct')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <PromptField
        label={t('components.configCommands.form.content')}
        promptId={value.prompt_id}
        content={value.content}
        onChange={(patch) =>
          onChange({
            ...(patch.promptId !== undefined ? { prompt_id: patch.promptId } : {}),
            ...(patch.content !== undefined ? { content: patch.content } : {}),
          })
        }
        placeholder={
          value.type === 'struct'
            ? t('components.configCommands.form.placeholders.structContent')
            : t('components.configCommands.form.placeholders.content')
        }
        previewMaxHeight="200px"
      />
      {value.type === 'struct' && (
        <p className="text-tiny text-muted-foreground">
          {t('components.configCommands.form.structHint')}
        </p>
      )}
    </div>
  )
}
