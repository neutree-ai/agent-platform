import {
  type ProviderForm,
  type ProviderFormErrors,
  ProviderFormFields,
  validateProviderForm,
} from '@/components/dialogs/ProviderFormFields'
import { Button } from '@/components/ui/button'
import { DocumentedDialog } from '@/components/ui/documented-dialog'
import { SaveButton } from '@/components/ui/save-button'
import type { DialogProps } from '@/contexts/DialogStackContext'
import { getProviderDoc, getProviderDocsHint } from '@/docs/inline-help/provider-docs'
import { useCreateProvider } from '@/hooks/useProviders'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

const INITIAL_FORM: ProviderForm = {
  name: '',
  description: '',
  provider_type: 'anthropic',
  base_url: '',
  api_key: '',
  visibility: 'private',
  team_ids: [],
}

/**
 * Create-provider dialog — registered against the DialogStack so the same
 * dialog can be triggered from the Providers app, the Command Palette, or
 * any other surface that calls `openDialog('create-provider')`.
 */
export default function CreateProviderDialog({ open, onOpenChange }: DialogProps) {
  const { t } = useTranslation()
  const createProvider = useCreateProvider()
  const [form, setForm] = useState<ProviderForm>(INITIAL_FORM)
  const [errors, setErrors] = useState<ProviderFormErrors>({})
  const [generalError, setGeneralError] = useState<string | null>(null)

  // Reset whenever the dialog re-opens — registry-mounted dialogs persist
  // across navigation, so stale form state would otherwise carry over.
  useEffect(() => {
    if (open) {
      setForm(INITIAL_FORM)
      setErrors({})
      setGeneralError(null)
    }
  }, [open])

  async function handleSave() {
    const next = validateProviderForm(form, { isEditing: false })
    setErrors(next)
    if (Object.keys(next).length > 0) return
    setGeneralError(null)
    try {
      const { team_ids, visibility, ...rest } = form
      await createProvider.mutateAsync({
        ...rest,
        visibility,
        grants:
          visibility === 'team'
            ? team_ids.map((team_id) => ({ team_id, permission: 'viewer' as const }))
            : undefined,
      })
      toast.success(t('components.createProvider.toasts.created'))
      onOpenChange(false)
    } catch (err) {
      setGeneralError(
        err instanceof Error ? err.message : t('components.createProvider.errors.createFailed'),
      )
    }
  }

  // Translate validation error keys to localized strings before passing down.
  const localizedErrors: ProviderFormErrors = {
    name: errors.name ? t(errors.name) : undefined,
    baseUrl: errors.baseUrl ? t(errors.baseUrl) : undefined,
    apiKey: errors.apiKey ? t(errors.apiKey) : undefined,
    teams: errors.teams ? t(errors.teams) : undefined,
  }

  return (
    <DocumentedDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('components.createProvider.title')}
      docs={getProviderDoc(form.provider_type)}
      docsHint={getProviderDocsHint()}
      footer={
        <>
          <Button type="button" size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <SaveButton
            isSaving={createProvider.isPending}
            onClick={handleSave}
            label={t('common.create')}
          />
        </>
      }
    >
      <ProviderFormFields form={form} setForm={setForm} errors={localizedErrors} />
      {generalError && <div className="mt-3 text-xs text-destructive">{generalError}</div>}
    </DocumentedDialog>
  )
}
