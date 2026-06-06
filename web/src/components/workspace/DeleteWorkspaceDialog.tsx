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
import { Spinner } from '@/components/ui/spinner'
import { useDeleteWorkspace } from '@/hooks/useWorkspaces'
import type { Workspace } from '@/lib/api/types'
import { AlertTriangle } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface DeleteWorkspaceDialogProps {
  workspace: Workspace
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function DeleteWorkspaceDialog({
  workspace,
  open,
  onOpenChange,
}: DeleteWorkspaceDialogProps) {
  const { t } = useTranslation()
  const [confirmName, setConfirmName] = useState('')
  const deleteMutation = useDeleteWorkspace()

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v)
        if (!v) setConfirmName('')
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4" />
            {t('components.deleteWorkspace.title')}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-muted-foreground">
            {t('components.deleteWorkspace.description.prefix')}
            <span className="font-medium text-foreground">{workspace.name}</span>
            {t('components.deleteWorkspace.description.suffix')}
          </p>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">
              {t('components.deleteWorkspace.confirm.labelPrefix')}
              <span className="font-mono font-medium text-foreground">{workspace.name}</span>
              {t('components.deleteWorkspace.confirm.labelSuffix')}
            </Label>
            <Input
              autoFocus
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={workspace.name}
              className="text-sm font-mono"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={confirmName !== workspace.name || deleteMutation.isPending}
            onClick={() => {
              deleteMutation.mutate(workspace.id)
              onOpenChange(false)
            }}
          >
            {deleteMutation.isPending ? <Spinner size="sm" className="mr-1" /> : null}
            {t('components.deleteWorkspace.actions.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
