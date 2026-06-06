import { Button } from '@/components/ui/button'
import { DocumentedDialog } from '@/components/ui/documented-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SaveButton } from '@/components/ui/save-button'
import { Textarea } from '@/components/ui/textarea'
import type { DialogProps } from '@/contexts/DialogStackContext'
import { getOAuthAppDoc, getOAuthAppDocsHint } from '@/docs/inline-help/oauth-app-docs'
import { api } from '@/lib/api/client'
import type { ApiApplication, ApiApplicationSecret } from '@/lib/api/types'
import { cn } from '@/lib/utils'
import { Check, Copy, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface ApplicationDialogProps extends DialogProps {
  application?: ApiApplication | null
  /**
   * When provided, dialog opens directly into the reveal-once view (used
   * by the rotate-secret flow — no form, just the new credentials).
   */
  revealed?: ApiApplicationSecret | null
  onSuccess?: () => void
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export default function ApplicationDialog({
  open,
  onOpenChange,
  application,
  revealed,
  onSuccess,
}: ApplicationDialogProps) {
  const { t } = useTranslation()
  const isEdit = !!application

  const [name, setName] = useState(application?.name ?? '')
  const [description, setDescription] = useState(application?.description ?? '')
  const [homepageUrl, setHomepageUrl] = useState(application?.homepage_url ?? '')
  const [customId, setCustomId] = useState('')
  const [redirectUrisText, setRedirectUrisText] = useState(
    application?.redirect_uris.join('\n') ?? '',
  )
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<ApiApplicationSecret | null>(null)
  const [copied, setCopied] = useState<'id' | 'secret' | null>(null)

  // Re-seed when re-opened so a different `application` prop or stale
  // revealed-secret state doesn't carry over.
  useEffect(() => {
    if (open) {
      setName(application?.name ?? '')
      setDescription(application?.description ?? '')
      setHomepageUrl(application?.homepage_url ?? '')
      setCustomId('')
      setRedirectUrisText(application?.redirect_uris.join('\n') ?? '')
      setError(null)
      setCreated(null)
      setCopied(null)
    }
  }, [open, application])

  function handleClose() {
    if (created) onSuccess?.()
    onOpenChange(false)
  }

  async function handleSave() {
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError(t('components.applicationDialog.errors.nameRequired'))
      return
    }
    const redirectUris = redirectUrisText
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (redirectUris.length === 0) {
      setError(t('components.applicationDialog.errors.redirectUrisRequired'))
      return
    }
    if (!redirectUris.every(isHttpUrl)) {
      setError(t('components.applicationDialog.errors.invalidUrl'))
      return
    }
    const trimmedHomepage = homepageUrl.trim()
    if (trimmedHomepage && !isHttpUrl(trimmedHomepage)) {
      setError(t('components.applicationDialog.errors.invalidUrl'))
      return
    }
    const trimmedDescription = description.trim()

    setIsSaving(true)
    setError(null)
    try {
      if (isEdit && application) {
        await api.updateApplication(application.id, {
          name: trimmedName,
          description: trimmedDescription || null,
          homepage_url: trimmedHomepage || null,
          redirect_uris: redirectUris,
        })
        onSuccess?.()
        onOpenChange(false)
      } else {
        const result = await api.createApplication({
          id: customId.trim() || undefined,
          name: trimmedName,
          description: trimmedDescription || null,
          homepage_url: trimmedHomepage || null,
          redirect_uris: redirectUris,
        })
        setCreated(result)
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t(
              isEdit
                ? 'components.applicationDialog.errors.saveFailed'
                : 'components.applicationDialog.errors.createFailed',
            ),
      )
    } finally {
      setIsSaving(false)
    }
  }

  async function handleCopy(which: 'id' | 'secret', value: string) {
    await navigator.clipboard.writeText(value)
    setCopied(which)
    setTimeout(() => setCopied(null), 2000)
  }

  // Reveal mode covers two paths: the post-create response (`created`)
  // and the post-rotate response passed in via the `revealed` prop.
  const revealSecret = created ?? revealed ?? null
  const isReveal = revealSecret !== null

  const title = isReveal
    ? created
      ? t('components.applicationDialog.titleCreated')
      : t('components.applicationDialog.titleRotated')
    : isEdit
      ? t('components.applicationDialog.titleEdit')
      : t('components.applicationDialog.titleCreate')

  return (
    <DocumentedDialog
      open={open}
      onOpenChange={handleClose}
      title={title}
      docs={getOAuthAppDoc()}
      docsHint={getOAuthAppDocsHint()}
      size="lg"
      footer={
        isReveal ? (
          <Button type="button" size="sm" onClick={handleClose}>
            {t('components.applicationDialog.actions.done')}
          </Button>
        ) : (
          <>
            <Button type="button" size="sm" variant="ghost" onClick={handleClose}>
              {t('components.applicationDialog.actions.cancel')}
            </Button>
            <SaveButton
              isSaving={isSaving}
              onClick={handleSave}
              disabled={!name.trim() || !redirectUrisText.trim()}
              label={
                isEdit
                  ? t('components.applicationDialog.actions.save')
                  : t('components.applicationDialog.actions.create')
              }
            />
          </>
        )
      }
    >
      {isReveal && revealSecret ? (
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
            <TriangleAlert className="h-4 w-4 shrink-0" strokeWidth={2} />
            <span>{t('components.applicationDialog.help.storeSecurely')}</span>
          </div>
          <CodeReveal
            label={t('components.applicationDialog.fields.clientId')}
            value={revealSecret.id}
            copied={copied === 'id'}
            onCopy={() => handleCopy('id', revealSecret.id)}
          />
          <CodeReveal
            label={t('components.applicationDialog.fields.clientSecret')}
            value={revealSecret.client_secret}
            copied={copied === 'secret'}
            onCopy={() => handleCopy('secret', revealSecret.client_secret)}
          />
        </div>
      ) : (
        <div className="space-y-4">
          <Field label={t('components.applicationDialog.fields.name')} htmlFor="app-name">
            <Input
              id="app-name"
              className="h-9 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('components.applicationDialog.placeholders.name')}
            />
          </Field>
          {!isEdit && (
            <Field
              label={t('components.applicationDialog.fields.customId')}
              htmlFor="app-custom-id"
            >
              <Input
                id="app-custom-id"
                className="h-9 font-mono text-sm"
                value={customId}
                onChange={(e) => setCustomId(e.target.value)}
                placeholder={t('components.applicationDialog.placeholders.customId')}
              />
            </Field>
          )}
          <Field
            label={t('components.applicationDialog.fields.description')}
            htmlFor="app-description"
          >
            <Input
              id="app-description"
              className="h-9 text-sm"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('components.applicationDialog.placeholders.description')}
            />
          </Field>
          <Field
            label={t('components.applicationDialog.fields.homepageUrl')}
            htmlFor="app-homepage"
          >
            <Input
              id="app-homepage"
              className="h-9 text-sm"
              value={homepageUrl}
              onChange={(e) => setHomepageUrl(e.target.value)}
              placeholder={t('components.applicationDialog.placeholders.homepageUrl')}
            />
          </Field>
          <Field
            label={t('components.applicationDialog.fields.redirectUris')}
            htmlFor="app-redirect-uris"
            help={t('components.applicationDialog.help.redirectUrisHint')}
          >
            <Textarea
              id="app-redirect-uris"
              className="min-h-[80px] resize-none font-mono text-sm"
              value={redirectUrisText}
              onChange={(e) => setRedirectUrisText(e.target.value)}
              placeholder={t('components.applicationDialog.placeholders.redirectUris')}
            />
          </Field>
          {error && <div className="text-xs text-destructive">{error}</div>}
        </div>
      )}
    </DocumentedDialog>
  )
}

function Field({
  label,
  htmlFor,
  help,
  children,
}: {
  label: string
  htmlFor?: string
  help?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </Label>
      {children}
      {help && <p className="text-tiny text-muted-foreground">{help}</p>}
    </div>
  )
}

function CodeReveal({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string
  value: string
  copied: boolean
  onCopy: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium">{label}</Label>
      <div className="relative">
        <pre className="overflow-x-auto rounded-md border border-foreground/[0.08] bg-foreground/[0.04] p-3 pr-12 font-mono text-xs">
          {value}
        </pre>
        <button
          type="button"
          onClick={onCopy}
          aria-label={t('components.applicationDialog.actions.copy')}
          title={t(
            copied
              ? 'components.applicationDialog.actions.copied'
              : 'components.applicationDialog.actions.copy',
          )}
          className={cn(
            'absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded',
            'text-muted-foreground/70 hover:text-foreground hover:bg-foreground/[0.06]',
            'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25',
          )}
        >
          {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
    </div>
  )
}
