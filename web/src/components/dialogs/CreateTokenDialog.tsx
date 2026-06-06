import { Button } from '@/components/ui/button'
import { DocumentedDialog } from '@/components/ui/documented-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SaveButton } from '@/components/ui/save-button'
import type { DialogProps } from '@/contexts/DialogStackContext'
import { getServiceTokenDoc, getServiceTokenDocsHint } from '@/docs/inline-help/service-token-docs'
import { api } from '@/lib/api/client'
import { isCommitEnter } from '@/lib/keyboard'
import { cn } from '@/lib/utils'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

const serviceTokensQueryKey = ['service-tokens'] as const

/**
 * Create-service-token dialog. Two-state: name input → reveal-once token
 * view (the raw token value is only available in the create response and
 * never re-served, so we have to surface it inline + warn the user).
 *
 * Uses `DocumentedDialog` so the side panel always shows what service
 * tokens are for (external API access) — the create flow is short, but
 * the docs are the only place new users learn the typical usage and the
 * `Authorization: Bearer` header convention.
 */
export default function CreateTokenDialog({ open, onOpenChange }: DialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [createdToken, setCreatedToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Reset whenever the dialog re-opens.
  useEffect(() => {
    if (open) {
      setName('')
      setError(null)
      setCreatedToken(null)
      setCopied(false)
    }
  }, [open])

  const create = useMutation({
    mutationFn: (n: string) => api.createServiceToken(n),
    onSuccess: (token) => {
      queryClient.invalidateQueries({ queryKey: serviceTokensQueryKey })
      setCreatedToken(token.token ?? '')
      toast.success(t('components.createToken.toasts.created'))
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : t('components.createToken.errors.createFailed'))
    },
  })

  function handleCreate() {
    if (!name.trim()) {
      setError(t('components.createToken.errors.nameRequired'))
      return
    }
    setError(null)
    create.mutate(name.trim())
  }

  async function handleCopy() {
    if (!createdToken) return
    await navigator.clipboard.writeText(createdToken)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  const isReveal = createdToken !== null

  return (
    <DocumentedDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t(isReveal ? 'components.createToken.createdTitle' : 'components.createToken.title')}
      docs={getServiceTokenDoc()}
      docsHint={getServiceTokenDocsHint()}
      footer={
        !isReveal ? (
          <>
            <Button type="button" size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <SaveButton
              isSaving={create.isPending}
              onClick={handleCreate}
              label={t('common.create')}
            />
          </>
        ) : (
          <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
            {t('components.createToken.actions.done')}
          </Button>
        )
      }
    >
      {!isReveal ? (
        <div className="space-y-1.5">
          <Label htmlFor="token-name" className="text-sm font-medium">
            {t('components.createToken.fields.name')}
          </Label>
          <Input
            id="token-name"
            className="h-9 text-sm"
            placeholder={t('components.createToken.placeholders.name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (isCommitEnter(e)) handleCreate()
            }}
            autoFocus
          />
          {error && <div className="text-xs text-destructive">{error}</div>}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
            <TriangleAlert className="h-4 w-4 shrink-0" strokeWidth={2} />
            <span>{t('components.createToken.warnings.saveNow')}</span>
          </div>
          <div className="relative">
            <pre className="overflow-x-auto rounded-md border border-foreground/[0.08] bg-foreground/[0.04] p-3 pr-12 font-mono text-xs">
              {createdToken}
            </pre>
            <button
              type="button"
              onClick={handleCopy}
              aria-label={t('components.createToken.actions.copy')}
              title={t(
                copied
                  ? 'components.createToken.actions.copied'
                  : 'components.createToken.actions.copy',
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
      )}
    </DocumentedDialog>
  )
}
