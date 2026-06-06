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
import { api } from '@/lib/api/client'
import { isCommitEnter } from '@/lib/keyboard'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

interface ResetPasswordDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  userId: string
  username: string
}

export default function ResetPasswordDialog({
  open,
  onOpenChange,
  userId,
  username,
}: ResetPasswordDialogProps) {
  const { t } = useTranslation()
  const [password, setPassword] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleClose() {
    setPassword('')
    setError(null)
    onOpenChange(false)
  }

  async function handleSave() {
    if (!password || password.length < 6) {
      setError(t('components.admin.resetPassword.errors.passwordTooShort'))
      return
    }
    setIsSaving(true)
    setError(null)
    try {
      await api.resetAdminUserPassword(userId, password)
      toast.success(t('components.admin.resetPassword.toasts.updated', { username }))
      handleClose()
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('components.admin.resetPassword.errors.resetFailed'),
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('components.admin.resetPassword.title', { username })}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">
              {t('components.admin.resetPassword.fields.newPassword')}
            </Label>
            <Input
              className="h-8 text-xs focus-visible:ring-inset"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (isCommitEnter(e)) handleSave()
              }}
            />
          </div>
          {error && <div className="text-xs text-destructive">{error}</div>}
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={handleClose}>
            {t('common.cancel')}
          </Button>
          <SaveButton isSaving={isSaving} onClick={handleSave} disabled={!password} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
