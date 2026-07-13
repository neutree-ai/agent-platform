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
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: ReactNode
  confirmLabel: string
  confirmVariant?: 'default' | 'destructive'
  /** When set, the user must type this exact phrase to enable the confirm button. */
  confirmPhrase?: string
  /** Label shown above the type-to-confirm input. */
  confirmPhraseLabel?: string
  /** The action; may throw to surface an inline error and keep the dialog open. */
  onConfirm: () => Promise<void> | void
}

/**
 * Reusable confirmation dialog. Without `confirmPhrase` it is a plain
 * confirm/cancel; with it, the confirm button stays disabled until the user
 * types the phrase (type-to-confirm for destructive actions).
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  confirmVariant = 'default',
  confirmPhrase,
  confirmPhraseLabel,
  onConfirm,
}: ConfirmDialogProps) {
  const { t } = useTranslation()
  const [typed, setTyped] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function close() {
    setTyped('')
    setError(null)
    onOpenChange(false)
  }

  const phraseOk = !confirmPhrase || typed.trim() === confirmPhrase
  const canConfirm = phraseOk && !pending

  async function handleConfirm() {
    if (!canConfirm) return
    setPending(true)
    setError(null)
    try {
      await onConfirm()
      close()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) close()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {description && <div className="text-xs text-muted-foreground">{description}</div>}
          {confirmPhrase && (
            <div className="space-y-1">
              {confirmPhraseLabel && <Label className="text-xs">{confirmPhraseLabel}</Label>}
              <Input
                className="h-8 text-xs focus-visible:ring-inset"
                value={typed}
                placeholder={confirmPhrase}
                autoComplete="off"
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleConfirm()
                }}
              />
            </div>
          )}
          {error && <div className="text-xs text-destructive">{error}</div>}
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button variant={confirmVariant} size="sm" disabled={!canConfirm} onClick={handleConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
