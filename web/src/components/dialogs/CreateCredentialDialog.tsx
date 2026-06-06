import {
  type CredentialForm,
  type CredentialFormErrors,
  CredentialFormFields,
  INITIAL_CREDENTIAL_FORM,
  validateCredentialForm,
} from '@/components/dialogs/CredentialFormFields'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { SaveButton } from '@/components/ui/save-button'
import type { DialogProps } from '@/contexts/DialogStackContext'
import { api } from '@/lib/api/client'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

const credentialsQueryKey = ['credentials'] as const

/**
 * Create-credential dialog — registered against the DialogStack so the same
 * dialog can be triggered from the Credentials app, the Command Palette, or
 * markdown link callers.
 */
export default function CreateCredentialDialog({ open, onOpenChange }: DialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<CredentialForm>(INITIAL_CREDENTIAL_FORM)
  const [errors, setErrors] = useState<CredentialFormErrors>({})
  const [generalError, setGeneralError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setForm(INITIAL_CREDENTIAL_FORM)
      setErrors({})
      setGeneralError(null)
    }
  }, [open])

  const upsert = useMutation({
    mutationFn: async (data: CredentialForm) => {
      let value = data.value
      if (data.inject === 'file' && value && !value.endsWith('\n')) {
        value += '\n'
      }
      await api.upsertCredential(data.name, {
        value,
        inject: data.inject,
        path: data.inject === 'file' ? data.path : undefined,
        mode: data.inject === 'file' ? data.mode : undefined,
        scope: data.scope,
        workspace_ids: data.scope === 'selected' ? data.workspaceIds : undefined,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: credentialsQueryKey })
      toast.success(t('components.createCredential.toasts.created'))
      onOpenChange(false)
    },
    onError: (err) => {
      setGeneralError(
        err instanceof Error ? err.message : t('components.createCredential.errors.createFailed'),
      )
    },
  })

  function handleSave() {
    const next = validateCredentialForm(form)
    setErrors(next)
    if (Object.keys(next).length > 0) return
    setGeneralError(null)
    upsert.mutate(form)
  }

  const localizedErrors: CredentialFormErrors = {
    name: errors.name ? t(errors.name) : undefined,
    value: errors.value ? t(errors.value) : undefined,
    path: errors.path ? t(errors.path) : undefined,
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">
            {t('components.createCredential.title')}
          </DialogTitle>
        </DialogHeader>
        <CredentialFormFields form={form} setForm={setForm} errors={localizedErrors} />
        {generalError && <div className="mt-3 text-xs text-destructive">{generalError}</div>}
        <DialogFooter>
          <Button type="button" size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <SaveButton isSaving={upsert.isPending} onClick={handleSave} label={t('common.create')} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
