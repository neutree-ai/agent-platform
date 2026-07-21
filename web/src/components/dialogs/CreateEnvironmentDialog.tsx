import {
  type EnvironmentForm,
  type EnvironmentFormErrors,
  EnvironmentFormFields,
  validateEnvironmentForm,
} from '@/components/dialogs/EnvironmentFormFields'
import { SecretReveal } from '@/components/dialogs/SecretReveal'
import { Button } from '@/components/ui/button'
import { DocumentedDialog } from '@/components/ui/documented-dialog'
import { SaveButton } from '@/components/ui/save-button'
import type { DialogProps } from '@/contexts/DialogStackContext'
import { useCreateEnvironment, useCreateEnvironmentToken } from '@/hooks/useEnvironments'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

const INITIAL_FORM: EnvironmentForm = {
  name: '',
  visibility: 'private',
  team_ids: [],
}

/**
 * Register-environment dialog. Two phases:
 *   1. collect name + visibility + team grants → create the environment
 *   2. auto-issue the first runner token and reveal it once, with a Helm
 *      install hint so the operator can bring the runner online immediately.
 *
 * Registered against the DialogStack as `create-environment`.
 */
export default function CreateEnvironmentDialog({ open, onOpenChange }: DialogProps) {
  const { t } = useTranslation()
  const createEnvironment = useCreateEnvironment()
  const createToken = useCreateEnvironmentToken()
  const [form, setForm] = useState<EnvironmentForm>(INITIAL_FORM)
  const [errors, setErrors] = useState<EnvironmentFormErrors>({})
  const [generalError, setGeneralError] = useState<string | null>(null)
  // Reveal phase: set once the environment + first token exist.
  const [created, setCreated] = useState<{ token: string } | null>(null)

  // Registry-mounted dialogs persist across navigation — reset on re-open.
  useEffect(() => {
    if (open) {
      setForm(INITIAL_FORM)
      setErrors({})
      setGeneralError(null)
      setCreated(null)
    }
  }, [open])

  const pending = createEnvironment.isPending || createToken.isPending

  async function handleCreate() {
    const next = validateEnvironmentForm(form)
    setErrors(next)
    if (Object.keys(next).length > 0) return
    setGeneralError(null)
    try {
      const { team_ids, visibility, name } = form
      const env = await createEnvironment.mutateAsync({
        name: name.trim(),
        visibility,
        grants:
          visibility === 'team'
            ? team_ids.map((team_id) => ({ team_id, permission: 'viewer' as const }))
            : undefined,
      })
      const token = await createToken.mutateAsync({
        id: env.id,
        name: t('components.createEnvironment.defaultTokenName'),
      })
      setCreated({ token: token.token })
      toast.success(t('components.createEnvironment.toasts.created'))
    } catch (err) {
      setGeneralError(
        err instanceof Error ? err.message : t('components.createEnvironment.errors.createFailed'),
      )
    }
  }

  const localizedErrors: EnvironmentFormErrors = {
    name: errors.name ? t(errors.name) : undefined,
    teams: errors.teams ? t(errors.teams) : undefined,
  }

  const isReveal = created !== null
  const controlPlaneUrl = window.location.origin

  return (
    <DocumentedDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t(
        isReveal
          ? 'components.createEnvironment.createdTitle'
          : 'components.createEnvironment.title',
      )}
      footer={
        !isReveal ? (
          <>
            <Button type="button" size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <SaveButton isSaving={pending} onClick={handleCreate} label={t('common.create')} />
          </>
        ) : (
          <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
            {t('components.createEnvironment.actions.done')}
          </Button>
        )
      }
    >
      {!isReveal ? (
        <>
          <EnvironmentFormFields form={form} setForm={setForm} errors={localizedErrors} />
          {generalError && <div className="mt-3 text-xs text-destructive">{generalError}</div>}
        </>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            {t('components.createEnvironment.revealIntro')}
          </p>
          <SecretReveal value={created.token} />
          <div className="space-y-1.5">
            <div className="text-xs font-medium">{t('components.createEnvironment.helmTitle')}</div>
            <pre className="whitespace-pre-wrap break-all rounded-md border border-foreground/[0.08] bg-foreground/[0.04] p-3 font-mono text-tiny leading-relaxed text-muted-foreground">
              {`helm install my-env ./charts/env-runner-k8s \\
  --namespace agent-runner --create-namespace \\
  --set controlPlane.url=${controlPlaneUrl} \\
  --set envToken.token=${created.token}`}
            </pre>
          </div>
        </div>
      )}
    </DocumentedDialog>
  )
}
