import CreateUserDialog from '@/components/dialogs/CreateUserDialog'
import DeleteUserDialog from '@/components/dialogs/DeleteUserDialog'
import ResetPasswordDialog from '@/components/dialogs/ResetPasswordDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { api } from '@/lib/api/client'
import type { AdminUsersPage, AdminUsersSort } from '@/lib/api/types'
import { useInstancePersistentState } from '@/stores/instance-state-store'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  Plus,
  Search,
  Trash2,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatCompact } from './format'

const PAGE_SIZE = 10
const adminUsersQueryKey = ['admin-users'] as const

export function UsersSection({ instanceId }: { instanceId: string }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [resetTarget, setResetTarget] = useState<{ id: string; username: string } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string
    username: string
    displayName: string
  } | null>(null)

  // Sort preference persists across reopening the admin app; default token desc.
  const [sort, setSort] = useInstancePersistentState<AdminUsersSort>(
    instanceId,
    'usersSort',
    () => 'tokens',
  )
  const [order, setOrder] = useInstancePersistentState<'asc' | 'desc'>(
    instanceId,
    'usersOrder',
    () => 'desc',
  )
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')

  // Debounce the search box, and snap back to page 1 whenever the term settles.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(search.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  const { data, isLoading, isFetching } = useQuery<AdminUsersPage>({
    queryKey: [...adminUsersQueryKey, { page, sort, order, q }],
    queryFn: () => api.getAdminUsers({ page, pageSize: PAGE_SIZE, sort, order, q: q || undefined }),
    placeholderData: keepPreviousData,
  })

  function handleSort(col: AdminUsersSort) {
    if (sort === col) {
      setOrder(order === 'asc' ? 'desc' : 'asc')
    } else {
      setSort(col)
      setOrder('desc')
    }
    setPage(1)
  }

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  function SortHeader({
    label,
    col,
    numeric,
  }: {
    label: string
    col: AdminUsersSort
    numeric?: boolean
  }) {
    const active = sort === col
    return (
      <TableHead className={numeric ? 'text-right' : undefined}>
        <button
          type="button"
          onClick={() => handleSort(col)}
          className="inline-flex items-center gap-1 text-xs hover:text-foreground"
        >
          {label}
          {active ? (
            order === 'asc' ? (
              <ArrowUp className="h-3 w-3" />
            ) : (
              <ArrowDown className="h-3 w-3" />
            )
          ) : (
            <ArrowUpDown className="h-3 w-3 opacity-40" />
          )}
        </button>
      </TableHead>
    )
  }

  return (
    <>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="relative max-w-xs flex-1">
            <Search className="-translate-y-1/2 absolute top-1/2 left-2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('components.admin.usersSection.search.placeholder')}
              className="h-7 pl-7 text-xs"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-auto h-7 gap-1 px-2 text-xs"
            onClick={() => setShowCreateDialog(true)}
          >
            <Plus className="h-3 w-3" />
            {t('components.admin.usersSection.actions.newUser')}
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Spinner />
          </div>
        ) : total === 0 ? (
          <div className="py-10 text-center text-xs text-muted-foreground">
            {t('components.admin.usersSection.empty.noUsers')}
          </div>
        ) : (
          <>
            <div
              className={`rounded-md border transition-opacity ${isFetching ? 'opacity-60' : ''}`}
            >
              <Table className="text-xs">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <SortHeader
                      label={t('components.admin.usersSection.columns.name')}
                      col="name"
                    />
                    <SortHeader
                      label={t('components.admin.usersSection.columns.agents')}
                      col="agents"
                      numeric
                    />
                    <SortHeader
                      label={t('components.admin.usersSection.columns.interactions')}
                      col="interactions"
                      numeric
                    />
                    <SortHeader
                      label={t('components.admin.usersSection.columns.tokens')}
                      col="tokens"
                      numeric
                    />
                    <SortHeader
                      label={t('components.admin.usersSection.columns.lastActive')}
                      col="last_active"
                      numeric
                    />
                    <TableHead className="w-16" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((u) => (
                    <TableRow key={u.id} className="group">
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-medium">{u.display_name}</span>
                          <span className="text-mini text-muted-foreground">{u.username}</span>
                          {u.role === 'admin' && (
                            <Badge variant="outline" className="px-1 py-0 text-mini">
                              {t('components.admin.usersSection.badges.roleAdmin')}
                            </Badge>
                          )}
                          {u.auth_source === 'ldap' && (
                            <Badge variant="secondary" className="px-1 py-0 text-mini">
                              {t('components.admin.usersSection.badges.authSource.ldap')}
                            </Badge>
                          )}
                        </div>
                        {u.email && (
                          <div className="text-mini text-muted-foreground">{u.email}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground tabular-nums">
                        {u.agent_count.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground tabular-nums">
                        {u.interactions.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatCompact(u.tokens)}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground tabular-nums">
                        {u.last_active_at ? new Date(u.last_active_at).toLocaleDateString() : '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                          {u.auth_source === 'password' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              title={t('components.admin.usersSection.actions.resetPassword')}
                              onClick={() => setResetTarget({ id: u.id, username: u.username })}
                            >
                              <KeyRound className="h-3 w-3" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                            title={t('components.admin.usersSection.actions.deleteUser')}
                            onClick={() =>
                              setDeleteTarget({
                                id: u.id,
                                username: u.username,
                                displayName: u.display_name,
                              })
                            }
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{t('components.admin.usersSection.pagination.total', { count: total })}</span>
              <div className="flex items-center gap-2">
                <span className="tabular-nums">
                  {t('components.admin.usersSection.pagination.page', { page, pageCount })}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 w-6 p-0"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 w-6 p-0"
                  disabled={page >= pageCount}
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </>
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

      {deleteTarget && (
        <DeleteUserDialog
          open={true}
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null)
          }}
          userId={deleteTarget.id}
          username={deleteTarget.username}
          displayName={deleteTarget.displayName}
          onDeleted={() => queryClient.invalidateQueries({ queryKey: adminUsersQueryKey })}
        />
      )}
    </>
  )
}
