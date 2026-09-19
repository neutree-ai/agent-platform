import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Spinner } from '@/components/ui/spinner'
import { api } from '@/lib/api/client'
import type { ApiTransferPlan, TransferCopySelection, Workspace } from '@/lib/api/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowRightLeft } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { TransferPlanView } from './TransferPlanView'

interface TransferWorkspaceDialogProps {
  workspace: Workspace
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Offer a workspace to another user. The sender names the recipient, reviews
 * what the transfer does (and chooses which private prompts / skills to
 * copy), acknowledges the risks, and confirms by typing the workspace name.
 * The recipient then accepts or declines on their side.
 */
export function TransferWorkspaceDialog({
  workspace,
  open,
  onOpenChange,
}: TransferWorkspaceDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [username, setUsername] = useState('')
  const [plan, setPlan] = useState<ApiTransferPlan | null>(null)
  const [copy, setCopy] = useState<TransferCopySelection>({ prompts: [], skills: [] })
  const [acknowledged, setAcknowledged] = useState(false)
  const [confirmName, setConfirmName] = useState('')

  const reset = () => {
    setUsername('')
    setPlan(null)
    setCopy({ prompts: [], skills: [] })
    setAcknowledged(false)
    setConfirmName('')
  }

  const planMutation = useMutation({
    mutationFn: () => api.planWorkspaceTransfer(workspace.id, username.trim()),
    onSuccess: (p) => {
      setPlan(p)
      // Every private prompt / skill starts selected for copying.
      setCopy({
        prompts: p.copyable.prompts.map((x) => x.id),
        skills: p.copyable.skills.map((x) => x.id),
      })
    },
    onError: (err) => {
      setPlan(null)
      toast.error(
        err instanceof Error ? err.message : t('components.workspaceTransfer.errors.plan'),
      )
    },
  })

  const createMutation = useMutation({
    mutationFn: () =>
      api.createWorkspaceTransfer(workspace.id, { to_username: plan!.to_user.username, copy }),
    onSuccess: (transfer) => {
      queryClient.setQueryData(['workspace-transfer', workspace.id], transfer)
      toast.success(
        t('components.workspaceTransfer.toasts.offered', { name: transfer.to_user.display_name }),
      )
      onOpenChange(false)
      reset()
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : t('components.workspaceTransfer.errors.create'),
      ),
  })

  const canSubmit =
    !!plan &&
    !plan.blocked &&
    acknowledged &&
    confirmName === workspace.name &&
    !createMutation.isPending

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v)
        if (!v) reset()
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4" />
            {t('components.workspaceTransfer.title')}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 text-sm">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">
              {t('components.workspaceTransfer.recipient.label')}
            </Label>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (username.trim()) planMutation.mutate()
              }}
            >
              <Input
                autoFocus
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value)
                  setPlan(null)
                }}
                placeholder={t('components.workspaceTransfer.recipient.placeholder')}
                className="text-sm"
              />
              <Button
                type="submit"
                variant="outline"
                size="sm"
                className="h-9 shrink-0"
                disabled={!username.trim() || planMutation.isPending}
              >
                {planMutation.isPending ? <Spinner size="sm" className="mr-1" /> : null}
                {t('components.workspaceTransfer.recipient.review')}
              </Button>
            </form>
            <p className="text-mini text-muted-foreground">
              {t('components.workspaceTransfer.recipient.hint')}
            </p>
          </div>

          {plan && (
            <>
              <p className="text-xs text-muted-foreground">
                {t('components.workspaceTransfer.summary', {
                  workspace: workspace.name,
                  name: plan.to_user.display_name,
                  username: plan.to_user.username,
                })}
              </p>

              <div className="flex gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                <ul className="flex list-disc flex-col gap-1 pl-4 text-xs text-foreground">
                  <li>{t('components.workspaceTransfer.risks.files')}</li>
                  <li>{t('components.workspaceTransfer.risks.history')}</li>
                  <li>{t('components.workspaceTransfer.risks.access')}</li>
                </ul>
              </div>

              <ScrollArea className="max-h-72 rounded-md border border-border/60 p-3">
                <TransferPlanView plan={plan} copy={copy} onCopyChange={setCopy} />
              </ScrollArea>

              {!plan.blocked && (
                <>
                  <label className="flex items-start gap-2 text-xs">
                    <Checkbox
                      className="mt-0.5"
                      checked={acknowledged}
                      onCheckedChange={(v) => setAcknowledged(v === true)}
                    />
                    <span>{t('components.workspaceTransfer.acknowledge')}</span>
                  </label>
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs text-muted-foreground">
                      {t('components.deleteWorkspace.confirm.labelPrefix')}
                      <span className="font-mono font-medium text-foreground">
                        {workspace.name}
                      </span>
                      {t('components.deleteWorkspace.confirm.labelSuffix')}
                    </Label>
                    <Input
                      value={confirmName}
                      onChange={(e) => setConfirmName(e.target.value)}
                      placeholder={workspace.name}
                      className="font-mono text-sm"
                    />
                  </div>
                </>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" disabled={!canSubmit} onClick={() => createMutation.mutate()}>
            {createMutation.isPending ? <Spinner size="sm" className="mr-1" /> : null}
            {t('components.workspaceTransfer.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The workspace's pending transfer, if any. */
export function useWorkspaceTransfer(workspaceId: string) {
  return useQuery({
    queryKey: ['workspace-transfer', workspaceId],
    queryFn: () => api.getWorkspaceTransfer(workspaceId),
    staleTime: 30_000,
  })
}
