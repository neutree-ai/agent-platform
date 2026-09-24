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
import { ScrollArea } from '@/components/ui/scroll-area'
import { Spinner } from '@/components/ui/spinner'
import { TransferPlanView } from '@/components/workspace/transfer/TransferPlanView'
import { api } from '@/lib/api/client'
import type { AdminWorkspace, TransferCopySelection } from '@/lib/api/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRightLeft } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

interface AdminTransferDialogProps {
  workspace: AdminWorkspace
  onOpenChange: (open: boolean) => void
}

/**
 * Admin reassignment of a workspace to another user — for owners who have
 * left or cannot be reached. Runs immediately, without the recipient
 * accepting. When the recipient cannot use the workspace's provider, it is
 * left unset and the recipient picks one on first use.
 */
export function AdminTransferDialog({ workspace, onOpenChange }: AdminTransferDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [toUser, setToUser] = useState<{ id: string; display_name: string } | null>(null)
  const [copy, setCopy] = useState<TransferCopySelection>({ prompts: [], skills: [] })
  const [slug, setSlug] = useState('')
  const [confirmName, setConfirmName] = useState('')

  useEffect(() => {
    const h = setTimeout(() => setQ(search.trim()), 250)
    return () => clearTimeout(h)
  }, [search])

  const usersQuery = useQuery({
    queryKey: ['admin-users', 'transfer-picker', q],
    queryFn: () => api.getAdminUsers({ q, pageSize: 8 }),
    enabled: !toUser && q.length > 0,
  })

  const planQuery = useQuery({
    queryKey: ['admin-transfer-plan', workspace.id, toUser?.id],
    queryFn: () => api.planAdminWorkspaceTransfer(workspace.id, toUser!.id),
    enabled: !!toUser,
    retry: false,
  })
  const plan = planQuery.data

  useEffect(() => {
    if (!plan) return
    setCopy({
      prompts: plan.copyable.prompts.map((x) => x.id),
      skills: plan.copyable.skills.map((x) => x.id),
    })
    setSlug(plan.suggested_slug ?? '')
  }, [plan])

  const transferMutation = useMutation({
    mutationFn: () =>
      api.adminTransferWorkspace(workspace.id, {
        to_user_id: toUser!.id,
        copy,
        slug: plan?.slug_conflict ? slug.trim() : undefined,
      }),
    onSuccess: () => {
      toast.success(
        t('components.admin.workspacesSection.toasts.transferred', {
          name: workspace.name,
          user: toUser!.display_name,
        }),
      )
      queryClient.invalidateQueries({ queryKey: ['admin-workspaces'] })
      onOpenChange(false)
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : t('components.workspaceTransfer.errors.create'),
      ),
  })

  const canSubmit =
    !!plan &&
    !plan.blocked &&
    (!plan.slug_conflict || !!slug.trim()) &&
    confirmName === workspace.name &&
    !transferMutation.isPending

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4" />
            {t('components.admin.workspacesSection.transferDialog.title', { name: workspace.name })}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 text-sm">
          <p className="text-xs text-muted-foreground">
            {t('components.admin.workspacesSection.transferDialog.description')}
          </p>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">
              {t('components.workspaceTransfer.recipient.label')}
            </Label>
            {toUser ? (
              <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-2.5 py-1.5 text-xs">
                <span className="font-medium">{toUser.display_name}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => {
                    setToUser(null)
                    setConfirmName('')
                  }}
                >
                  {t('components.admin.workspacesSection.transferDialog.change')}
                </Button>
              </div>
            ) : (
              <>
                <Input
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('components.admin.workspacesSection.transferDialog.searchUser')}
                  className="text-sm"
                />
                {(usersQuery.data?.items ?? [])
                  .filter((u) => u.id !== workspace.owner_id)
                  .map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => setToUser({ id: u.id, display_name: u.display_name })}
                      className="flex items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-foreground/[0.06]"
                    >
                      <span className="font-medium">{u.display_name}</span>
                      <span className="font-mono text-muted-foreground">{u.username}</span>
                    </button>
                  ))}
              </>
            )}
          </div>

          {toUser && planQuery.isLoading && (
            <div className="flex h-16 items-center justify-center">
              <Spinner />
            </div>
          )}
          {planQuery.error && (
            <p className="text-xs text-destructive">
              {planQuery.error instanceof Error ? planQuery.error.message : ''}
            </p>
          )}

          {plan && (
            <>
              <ScrollArea className="max-h-72 rounded-md border border-border/60 p-3">
                <TransferPlanView plan={plan} copy={copy} onCopyChange={setCopy} />
              </ScrollArea>

              {plan.provider_required && (
                <p className="text-xs text-muted-foreground">
                  {t('components.admin.workspacesSection.transferDialog.noProvider')}
                </p>
              )}

              {plan.slug_conflict && (
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs text-muted-foreground">
                    {t('pages.transferPage.slug.label', { slug: plan.workspace.slug })}
                  </Label>
                  <Input
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                    className="font-mono text-sm"
                  />
                </div>
              )}

              {!plan.blocked && (
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs text-muted-foreground">
                    {t('components.deleteWorkspace.confirm.labelPrefix')}
                    <span className="font-mono font-medium text-foreground">{workspace.name}</span>
                    {t('components.deleteWorkspace.confirm.labelSuffix')}
                  </Label>
                  <Input
                    value={confirmName}
                    onChange={(e) => setConfirmName(e.target.value)}
                    placeholder={workspace.name}
                    className="font-mono text-sm"
                  />
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" disabled={!canSubmit} onClick={() => transferMutation.mutate()}>
            {transferMutation.isPending ? <Spinner size="sm" className="mr-1" /> : null}
            {t('components.admin.workspacesSection.transferDialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
