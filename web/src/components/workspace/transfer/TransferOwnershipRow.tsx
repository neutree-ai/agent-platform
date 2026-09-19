import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { api } from '@/lib/api/client'
import type { Workspace } from '@/lib/api/types'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowRightLeft, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { TransferWorkspaceDialog, useWorkspaceTransfer } from './TransferWorkspaceDialog'

/** Danger-zone row: offer the workspace to another user, or cancel a pending offer. */
export function TransferOwnershipRow({ workspace }: { workspace: Workspace }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const { data: pending } = useWorkspaceTransfer(workspace.id)

  const cancelMutation = useMutation({
    mutationFn: () => api.cancelWorkspaceTransfer(workspace.id),
    onSuccess: () => {
      queryClient.setQueryData(['workspace-transfer', workspace.id], null)
      toast.success(t('components.workspaceTransfer.toasts.cancelled'))
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : t('components.workspaceTransfer.errors.cancel'),
      ),
  })

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <ArrowRightLeft className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          {t('components.workspaceTransfer.title')}
        </div>
        <p className="mt-1 text-mini text-muted-foreground">
          {pending
            ? t('components.workspaceTransfer.pending', {
                name: pending.to_user.display_name,
                date: new Date(pending.expires_at).toLocaleDateString(),
              })
            : t('components.workspaceTransfer.description')}
        </p>
      </div>
      {pending ? (
        <Button
          variant="outline"
          size="sm"
          className="h-7 shrink-0 gap-1.5 px-2.5 text-xs"
          disabled={cancelMutation.isPending}
          onClick={() => cancelMutation.mutate()}
        >
          {cancelMutation.isPending ? (
            <Spinner size="sm" />
          ) : (
            <X className="h-3 w-3" strokeWidth={2} />
          )}
          {t('components.workspaceTransfer.cancel')}
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="h-7 shrink-0 gap-1.5 px-2.5 text-xs"
          onClick={() => setOpen(true)}
        >
          <ArrowRightLeft className="h-3 w-3" strokeWidth={2} />
          {t('components.workspaceTransfer.open')}
        </Button>
      )}
      <TransferWorkspaceDialog workspace={workspace} open={open} onOpenChange={setOpen} />
    </div>
  )
}
