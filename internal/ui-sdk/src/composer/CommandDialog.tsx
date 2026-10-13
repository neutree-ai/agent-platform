import { useState } from 'react'
import { useSdkTranslation } from '../i18n'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { Input } from '../ui/input'
import { parseTemplateVariables, resolveTemplate } from './text'
import type { ComposerCommand } from './types'

/** Form for a `struct` command: one field per `{{var}}`, sends the resolved text. */
export function CommandDialog({
  command,
  onOpenChange,
  onSend,
}: {
  command: ComposerCommand
  onOpenChange: (open: boolean) => void
  onSend: (text: string) => void
}) {
  const { t } = useSdkTranslation()
  const variables = parseTemplateVariables(command.content)
  const [values, setValues] = useState<Record<string, string>>({})
  const allFilled = variables.every((v) => values[v]?.trim())

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        closeLabel={t('components.composer.commands.close')}
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle className="text-sm">{command.name}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!allFilled) return
            onSend(resolveTemplate(command.content, values))
            onOpenChange(false)
          }}
          className="space-y-3"
        >
          {variables.map((v) => (
            <div key={v} className="space-y-1">
              <label htmlFor={`composer-var-${v}`} className="text-xs font-medium leading-none">
                {v}
              </label>
              <Input
                id={`composer-var-${v}`}
                value={values[v] ?? ''}
                onChange={(e) => setValues((prev) => ({ ...prev, [v]: e.target.value }))}
                className="h-8 text-xs"
              />
            </div>
          ))}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('components.composer.commands.cancel')}
            </Button>
            <Button type="submit" disabled={!allFilled}>
              {t('components.composer.commands.send')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
