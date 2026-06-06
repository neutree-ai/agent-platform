import { Button } from '@/components/ui/button'
import { DocumentedDialog } from '@/components/ui/documented-dialog'
import { SaveButton } from '@/components/ui/save-button'
import {
  ScheduleForm,
  type ScheduleMode,
  detectScheduleMode,
} from '@/components/workspace/ScheduleForm'
import { getScheduleDoc } from '@/docs/inline-help/misc-docs'
import { useCreateSchedule, useUpdateSchedule } from '@/hooks/useSchedules'
import type { Schedule } from '@/lib/api/types'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

interface Props {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When provided, the dialog is in edit mode for this schedule. */
  schedule?: Schedule
  /** When provided (and `schedule` is not), prefills a NEW schedule — used to fork a template schedule into a local copy. */
  forkInitial?: Schedule
  onSaved?: (id: string) => void
}

const FORM_ID = 'schedule-dialog'

export function ScheduleDialog({
  workspaceId,
  open,
  onOpenChange,
  schedule,
  forkInitial,
  onSaved,
}: Props) {
  const { t } = useTranslation()
  const createMutation = useCreateSchedule(workspaceId)
  const updateMutation = useUpdateSchedule(workspaceId)
  const isEditing = !!schedule
  const saving = createMutation.isPending || updateMutation.isPending

  // Mode is owned here so the docs panel can switch with the user's choice.
  const [mode, setMode] = useState<ScheduleMode>(() => detectScheduleMode(schedule ?? forkInitial))
  // Re-sync when the dialog is reopened for a different schedule — without
  // this, switching from a one-time row to a recurring row keeps the old mode.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-detect on open or target change
  useEffect(() => {
    if (open) setMode(detectScheduleMode(schedule ?? forkInitial))
  }, [open, schedule?.id, forkInitial?.id])

  return (
    <DocumentedDialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        isEditing
          ? t('components.automation.dialogs.editSchedule')
          : t('components.automation.dialogs.newSchedule')
      }
      docs={getScheduleDoc(mode)}
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
      <ScheduleForm
        formId={FORM_ID}
        initial={schedule ?? forkInitial}
        mode={mode}
        onModeChange={setMode}
        onSubmit={(data) => {
          if (isEditing && schedule) {
            updateMutation.mutate(
              { id: schedule.id, ...data },
              {
                onSuccess: () => {
                  toast.success(t('components.configSchedules.toasts.updated'))
                  onOpenChange(false)
                  onSaved?.(schedule.id)
                },
                onError: (err) => toast.error(err.message),
              },
            )
          } else {
            createMutation.mutate(data, {
              onSuccess: (created) => {
                toast.success(t('components.configSchedules.toasts.created'))
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
