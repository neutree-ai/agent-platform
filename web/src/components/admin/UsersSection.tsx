import CreateUserDialog from '@/components/dialogs/CreateUserDialog'
import ResetPasswordDialog from '@/components/dialogs/ResetPasswordDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmButton } from '@/components/ui/confirm-button'
import { Spinner } from '@/components/ui/spinner'
import { api } from '@/lib/api/client'
import type { AdminUser } from '@/lib/api/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

const adminUsersQueryKey = ['admin-users'] as const

// `instanceId` is reserved for future per-instance UI state (e.g. selection,
// search) scoped via `useInstancePersistentState`. Currently unused.
export function UsersSection({ instanceId: _instanceId }: { instanceId: string }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [resetTarget, setResetTarget] = useState<{ id: string; username: string } | null>(null)

  const { data: users = [], isLoading } = useQuery<AdminUser[]>({
    queryKey: adminUsersQueryKey,
    queryFn: () => api.getAdminUsers(),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteAdminUser(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminUsersQueryKey })
    },
  })

  async function handleDelete(id: string) {
    try {
      await deleteMutation.mutateAsync(id)
      toast.success(t('components.admin.usersSection.toasts.deleted'))
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t('components.admin.usersSection.errors.deleteFailed'),
      )
    }
  }

  const deletingId = deleteMutation.isPending ? (deleteMutation.variables ?? null) : null

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner />
      </div>
    )
  }

  return (
    <>
      <div className="space-y-3">
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => setShowCreateDialog(true)}
          >
            <Plus className="h-3 w-3" />
            {t('components.admin.usersSection.actions.newUser')}
          </Button>
        </div>

        {users.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            {t('components.admin.usersSection.empty.noUsers')}
          </div>
        ) : (
          <div className="space-y-1">
            {users.map((u) => (
              <div
                key={u.id}
                className="group flex items-center gap-2 rounded-md px-3 py-1.5 hover:bg-muted/50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium truncate">{u.display_name}</span>
                    <span className="text-tiny text-muted-foreground">{u.username}</span>
                    {u.role === 'admin' && (
                      <Badge variant="outline" className="text-mini px-1 py-0">
                        {t('components.admin.usersSection.badges.roleAdmin')}
                      </Badge>
                    )}
                    <Badge variant="secondary" className="text-mini px-1 py-0">
                      {u.auth_source === 'password'
                        ? t('components.admin.usersSection.badges.authSource.password')
                        : t('components.admin.usersSection.badges.authSource.ldap')}
                    </Badge>
                  </div>
                  <div className="text-tiny text-muted-foreground">
                    {u.email && <span>{u.email}</span>}
                    {u.last_login_at && (
                      <span className="ml-2">
                        {t('components.admin.usersSection.fields.lastLogin', {
                          value: new Date(u.last_login_at).toLocaleDateString(),
                        })}
                      </span>
                    )}
                  </div>
                </div>
                {u.auth_source === 'password' && (
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      title={t('components.admin.usersSection.actions.resetPassword')}
                      onClick={() => setResetTarget({ id: u.id, username: u.username })}
                    >
                      <KeyRound className="h-3 w-3" />
                    </Button>
                    <ConfirmButton
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                      icon={<Trash2 className="h-3 w-3" />}
                      tooltip={t('components.admin.usersSection.actions.deleteUser')}
                      disabled={deletingId === u.id}
                      onConfirm={() => handleDelete(u.id)}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <CreateUserDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: adminUsersQueryKey })
        }}
      />

      {resetTarget && (
        <ResetPasswordDialog
          open={true}
          onOpenChange={(open) => {
            if (!open) setResetTarget(null)
          }}
          userId={resetTarget.id}
          username={resetTarget.username}
        />
      )}
    </>
  )
}
