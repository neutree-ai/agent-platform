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
import { isCommitEnter } from '@/lib/keyboard'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,47}$/

interface NewShareDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (name: string) => Promise<void>
}

export function NewShareDialog({ open, onOpenChange, onSubmit }: NewShareDialogProps) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) {
      setName('')
      setError(null)
      setSubmitting(false)
    }
  }, [open])

  async function handleSubmit() {
    if (!NAME_RE.test(name)) {
      setError(t('components.afsShares.newDialog.invalidName'))
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit(name)
      onOpenChange(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('components.afsShares.newDialog.title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="share-name">{t('components.afsShares.newDialog.nameLabel')}</Label>
          <Input
            id="share-name"
            autoFocus
            placeholder={t('components.afsShares.newDialog.namePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (isCommitEnter(e) && !submitting) handleSubmit()
            }}
          />
          <p className="text-xs text-muted-foreground">
            {t('components.afsShares.newDialog.nameHint')}
          </p>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !name}>
            {submitting ? t('common.creating') : t('common.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
