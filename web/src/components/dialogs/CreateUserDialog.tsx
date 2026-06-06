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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

interface CreateUserDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

export default function CreateUserDialog({ open, onOpenChange, onSuccess }: CreateUserDialogProps) {
  const { t } = useTranslation()
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'user' | 'admin'>('user')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleClose() {
    setUsername('')
    setDisplayName('')
    setEmail('')
    setPassword('')
    setRole('user')
    setError(null)
    onOpenChange(false)
  }

  async function handleCreate() {
    if (!username.trim() || !displayName.trim() || !password) {
      setError(t('components.admin.createUser.errors.required'))
      return
    }
    if (password.length < 6) {
      setError(t('components.admin.createUser.errors.passwordTooShort'))
      return
    }
    setIsSaving(true)
    setError(null)
    try {
      await api.createAdminUser({
        username: username.trim(),
        display_name: displayName.trim(),
        password,
        email: email.trim() || undefined,
        role,
      })
      toast.success(t('components.admin.createUser.toasts.created'))
      onSuccess?.()
      handleClose()
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('components.admin.createUser.errors.createFailed'),
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('components.admin.createUser.title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">{t('components.admin.createUser.fields.username')}</Label>
            <Input
              className="h-8 text-xs focus-visible:ring-inset"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t('components.admin.createUser.placeholders.username')}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('components.admin.createUser.fields.displayName')}</Label>
            <Input
              className="h-8 text-xs focus-visible:ring-inset"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={t('components.admin.createUser.placeholders.displayName')}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('components.admin.createUser.fields.email')}</Label>
            <Input
              className="h-8 text-xs focus-visible:ring-inset"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('components.admin.createUser.placeholders.email')}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('components.admin.createUser.fields.password')}</Label>
            <Input
              className="h-8 text-xs focus-visible:ring-inset"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('components.admin.createUser.fields.role')}</Label>
            <div className="flex gap-3">
              {(['user', 'admin'] as const).map((r) => (
                <label key={r} className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input
                    type="radio"
                    name="role"
                    checked={role === r}
                    onChange={() => setRole(r)}
                    className="accent-primary"
                  />
                  {t(`components.admin.createUser.roles.${r}`)}
                </label>
              ))}
            </div>
          </div>
          {error && <div className="text-xs text-destructive">{error}</div>}
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={handleClose}>
            {t('common.cancel')}
          </Button>
          <SaveButton
            isSaving={isSaving}
            onClick={handleCreate}
            disabled={!username.trim() || !displayName.trim() || !password}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
