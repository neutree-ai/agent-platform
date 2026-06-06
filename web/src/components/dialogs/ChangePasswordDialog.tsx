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
import { ApiClientError, api } from '@/lib/api/client'
import { isCommitEnter } from '@/lib/keyboard'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

interface ChangePasswordDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function ChangePasswordDialog({ open, onOpenChange }: ChangePasswordDialogProps) {
  const { t } = useTranslation()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleClose() {
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setError(null)
    onOpenChange(false)
  }

  async function handleSave() {
    if (!currentPassword || !newPassword || !confirmPassword) {
      setError(t('components.preferences.security.password.errors.fieldsRequired'))
      return
    }
    if (newPassword.length < 6) {
      setError(t('components.preferences.security.password.errors.tooShort'))
      return
    }
    if (newPassword !== confirmPassword) {
      setError(t('components.preferences.security.password.errors.mismatch'))
      return
    }
    if (newPassword === currentPassword) {
      setError(t('components.preferences.security.password.errors.sameAsOld'))
      return
    }
    setIsSaving(true)
    setError(null)
    try {
      await api.changeMyPassword(currentPassword, newPassword)
      toast.success(t('components.preferences.security.password.toast.updated'))
      handleClose()
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        setError(t('components.preferences.security.password.errors.incorrectCurrent'))
      } else {
        setError(
          err instanceof Error
            ? err.message
            : t('components.preferences.security.password.errors.updateFailed'),
        )
      }
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : handleClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('components.preferences.security.password.dialog.title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">
              {t('components.preferences.security.password.dialog.currentPassword')}
            </Label>
            <Input
              className="h-8 text-xs focus-visible:ring-inset"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">
              {t('components.preferences.security.password.dialog.newPassword')}
            </Label>
            <Input
              className="h-8 text-xs focus-visible:ring-inset"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">
              {t('components.preferences.security.password.dialog.confirmPassword')}
            </Label>
            <Input
              className="h-8 text-xs focus-visible:ring-inset"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
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
          <SaveButton
            isSaving={isSaving}
            onClick={handleSave}
            disabled={!currentPassword || !newPassword || !confirmPassword}
            label={t('components.preferences.security.password.dialog.save')}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
