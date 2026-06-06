/**
 * Edit a git skill source's mutable settings: `git_ref` and `credential_name`.
 * Repo url/host/owner are immutable post-import (changing them would be a
 * different source); deletion lives in the same row's "…" menu.
 *
 * "Save" calls `PATCH /sources/:id`; the toast nudges the user to click Sync
 * to actually pull the new ref — we deliberately don't auto-sync so the user
 * stays in control of credentials and timing.
 */
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SaveButton } from '@/components/ui/save-button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useUpdateSkillSource } from '@/hooks/useSkills'
import { api } from '@/lib/api/client'
import type { ApiCredentialMeta, ApiSkillSource } from '@/lib/api/types'
import { useQuery } from '@tanstack/react-query'
import { type ReactNode, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor?: string
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </Label>
      {children}
    </div>
  )
}

interface EditSourceDialogProps {
  source: ApiSkillSource | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

const NONE_VALUE = '__none__'

export function EditSourceDialog({ source, open, onOpenChange }: EditSourceDialogProps) {
  const { t } = useTranslation()
  const update = useUpdateSkillSource()
  const [ref, setRef] = useState('')
  const [credentialName, setCredentialName] = useState<string>(NONE_VALUE)

  // Credentials loaded only while the dialog is open — avoids a sidewide
  // query on every Library mount.
  const credentialsQuery = useQuery<ApiCredentialMeta[]>({
    queryKey: ['credentials'],
    queryFn: () => api.listCredentials(),
    enabled: open,
    staleTime: 30_000,
  })
  const credentials = credentialsQuery.data ?? []

  // Reset on (re-)open. Mirror the latest server state into local form so
  // canceling out then reopening doesn't show stale edits.
  useEffect(() => {
    if (open && source) {
      setRef(source.git_ref ?? '')
      setCredentialName(source.credential_name ?? NONE_VALUE)
    }
  }, [open, source])

  if (!source) return null
  if (source.kind !== 'git') return null

  const onSave = async () => {
    const patch: { git_ref?: string; credential_name?: string | null } = {}
    const nextRef = ref.trim()
    if (nextRef !== (source.git_ref ?? '')) patch.git_ref = nextRef
    const nextCred = credentialName === NONE_VALUE ? null : credentialName
    if (nextCred !== (source.credential_name ?? null)) patch.credential_name = nextCred
    if (Object.keys(patch).length === 0) {
      onOpenChange(false)
      return
    }
    try {
      await update.mutateAsync({ id: source.id, patch })
      if ('git_ref' in patch) {
        toast.success(t('components.library.sources.edit.refChangedHint'))
      } else {
        toast.success(t('components.library.sources.edit.saved'))
      }
      onOpenChange(false)
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const repoLabel = [source.git_host, source.git_owner, source.git_repo].filter(Boolean).join('/')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('components.library.sources.edit.title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Field label={t('components.library.sources.edit.repoLabel')} htmlFor="src-repo">
            <Input id="src-repo" value={repoLabel} disabled className="h-9 text-sm" />
          </Field>
          <Field label={t('components.library.sources.edit.ref')} htmlFor="src-ref">
            <Input
              id="src-ref"
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              placeholder={t('components.library.sources.edit.refPlaceholder')}
              className="h-9 text-sm"
            />
          </Field>
          <Field label={t('components.library.sources.edit.credential')} htmlFor="src-cred">
            <Select value={credentialName} onValueChange={setCredentialName}>
              <SelectTrigger id="src-cred" className="h-9 text-sm focus:ring-inset">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE} className="py-2">
                  {t('components.library.sources.edit.credentialNone')}
                </SelectItem>
                {credentials
                  .filter((c) => c.inject === 'env')
                  .map((c) => (
                    <SelectItem key={c.name} value={c.name} className="py-2">
                      {c.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <DialogFooter>
          <Button type="button" size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <SaveButton isSaving={update.isPending} onClick={onSave} label={t('common.save')} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
