import { Button } from '@/components/ui/button'
import { DocumentedDialog } from '@/components/ui/documented-dialog'
import { SaveButton } from '@/components/ui/save-button'
import { CommandForm } from '@/components/workspace/CommandForm'
import { getCommandDoc } from '@/docs/inline-help/misc-docs'
import { useCreateCommand, useUpdateCommand } from '@/hooks/useCommands'
import type { WorkspaceCommand } from '@/lib/api/types'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

interface Props {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When provided, the dialog is in edit mode for this command. */
  command?: WorkspaceCommand
  /** When provided (and `command` is not), prefills a NEW command — used to fork a template command into a local copy. */
  forkInitial?: WorkspaceCommand
  onSaved?: (id: string) => void
}

const FORM_ID = 'command-dialog'

export function CommandDialog({
  workspaceId,
  open,
  onOpenChange,
  command,
  forkInitial,
  onSaved,
}: Props) {
  const { t } = useTranslation()
  const createMutation = useCreateCommand(workspaceId)
  const updateMutation = useUpdateCommand(workspaceId)
  const isEditing = !!command
  const saving = createMutation.isPending || updateMutation.isPending

  return (
    <DocumentedDialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        isEditing
          ? t('components.automation.dialogs.editCommand')
          : t('components.automation.dialogs.newCommand')
      }
      docs={getCommandDoc()}
      size="lg"
      footer={
        <>
          <Button type="button" size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <SaveButton
            type="submit"
            form={FORM_ID}
            isSaving={saving}
            label={isEditing ? t('common.save') : t('common.create')}
          />
        </>
      }
    >
      <CommandForm
        formId={FORM_ID}
        initial={command ?? forkInitial}
        onSubmit={(data) => {
          if (isEditing && command) {
            updateMutation.mutate(
              { id: command.id, ...data },
              {
                onSuccess: () => {
                  toast.success(t('components.configCommands.toasts.updated'))
                  onOpenChange(false)
                  onSaved?.(command.id)
                },
                onError: (err) => toast.error(err.message),
              },
            )
          } else {
            createMutation.mutate(data, {
              onSuccess: (created) => {
                toast.success(t('components.configCommands.toasts.created'))
                onOpenChange(false)
                onSaved?.(created.id)
              },
              onError: (err) => toast.error(err.message),
            })
          }
        }}
      />
    </DocumentedDialog>
  )
}
