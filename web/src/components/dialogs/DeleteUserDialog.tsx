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
import { api } from '@/lib/api/client'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

interface DeleteUserDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  userId: string
  username: string
  displayName: string
  onDeleted: () => void
}

export default function DeleteUserDialog({
  open,
  onOpenChange,
  userId,
  username,
  displayName,
  onDeleted,
}: DeleteUserDialogProps) {
  const { t } = useTranslation()
  const [confirm, setConfirm] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleClose() {
    setConfirm('')
    setError(null)
    onOpenChange(false)
  }

  const canDelete = confirm.trim() === username && !isDeleting

  async function handleDelete() {
    if (!canDelete) return
    setIsDeleting(true)
    setError(null)
    try {
      await api.deleteAdminUser(userId)
      toast.success(t('components.admin.deleteUser.toasts.deleted', { username }))
      onDeleted()
      handleClose()
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('components.admin.deleteUser.errors.deleteFailed'),
      )
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('components.admin.deleteUser.title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {t('components.admin.deleteUser.warning', { displayName, username })}
          </p>
          <div className="space-y-1">
            <Label className="text-xs">
              {t('components.admin.deleteUser.confirmLabel', { username })}
            </Label>
            <Input
              className="h-8 text-xs focus-visible:ring-inset"
              value={confirm}
              placeholder={username}
              autoComplete="off"
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleDelete()
              }}
            />
          </div>
          {error && <div className="text-xs text-destructive">{error}</div>}
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={handleClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="destructive" size="sm" disabled={!canDelete} onClick={handleDelete}>
            {t('components.admin.deleteUser.confirmButton')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
