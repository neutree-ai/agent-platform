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
import { listAfsShares } from '@/lib/api/agent-files'
import type { Workspace } from '@/lib/api/types'
import { AlertTriangle } from 'lucide-react'
import { useEffect, useState } from 'react'
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
  // Its shared folders go with it, from every workspace that has them.
  const [sharedFolders, setSharedFolders] = useState<{ folders: number; workspaces: number }>({
    folders: 0,
    workspaces: 0,
  })

  useEffect(() => {
    if (!open) return
    listAfsShares(workspace.id)
      .then((shares) => {
        const owned = shares.filter(
          (s) => s.role === 'owner' && (s.other_member_count > 0 || s.grant_count > 0),
        )
        setSharedFolders({
          folders: owned.length,
          workspaces: owned.reduce((n, s) => n + s.other_member_count, 0),
        })
      })
      .catch(() => setSharedFolders({ folders: 0, workspaces: 0 }))
  }, [open, workspace.id])

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
          {sharedFolders.folders > 0 && (
            <p className="rounded-md border border-destructive/30 bg-destructive/[0.06] px-3 py-2 text-xs text-destructive">
              {t('components.deleteWorkspace.sharedFolders', {
                folders: sharedFolders.folders,
                workspaces: sharedFolders.workspaces,
              })}
            </p>
          )}
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
