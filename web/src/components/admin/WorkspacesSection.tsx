import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import type { AdminWorkspace, AdminWorkspacesPage, AdminWorkspacesSort } from '@/lib/api/types'
import { useInstancePersistentState } from '@/stores/instance-state-store'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  CircleStop,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { formatCompact } from './format'

const PAGE_SIZE = 10
const STATUSES = ['running', 'stopped', 'error'] as const
type Status = (typeof STATUSES)[number]

const STATUS_VARIANT: Record<Status, 'success-soft' | 'secondary' | 'destructive-soft'> = {
  running: 'success-soft',
  stopped: 'secondary',
  error: 'destructive-soft',
}

export function WorkspacesSection({ instanceId }: { instanceId: string }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [action, setAction] = useState<{ kind: 'stop' | 'delete'; ws: AdminWorkspace } | null>(null)

  const [sort, setSort] = useInstancePersistentState<AdminWorkspacesSort>(
    instanceId,
    'workspacesSort',
    () => 'tokens',
  )
  const [order, setOrder] = useInstancePersistentState<'asc' | 'desc'>(
    instanceId,
    'workspacesOrder',
    () => 'desc',
  )
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<Status | ''>('')
  const [agentType, setAgentType] = useState('')
  const [owner, setOwner] = useState<{ id: string; name: string } | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(search.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  const { data, isLoading, isFetching } = useQuery<AdminWorkspacesPage>({
    queryKey: ['admin-workspaces', { page, sort, order, q, status, agentType, ownerId: owner?.id }],
    queryFn: () =>
      api.getAdminWorkspaces({
        page,
        pageSize: PAGE_SIZE,
        sort,
        order,
        q: q || undefined,
        status: status || undefined,
        agentType: agentType || undefined,
        ownerId: owner?.id,
      }),
    placeholderData: keepPreviousData,
  })

  // Agent-type options reuse the dashboard's aggregate; drop the empty bucket.
  const { data: agentTypes = [] } = useQuery({
    queryKey: ['admin-agent-types'],
    queryFn: () => api.getAdminAgentTypes(),
  })
  const agentTypeOptions = agentTypes.map((a) => a.agent_type).filter(Boolean)

  function handleSort(col: AdminWorkspacesSort) {
    if (sort === col) {
      setOrder(order === 'asc' ? 'desc' : 'asc')
    } else {
      setSort(col)
      setOrder('desc')
    }
    setPage(1)
  }

  function resetPageThen<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v)
      setPage(1)
    }
  }

  // Runs the pending stop/delete; throws propagate to the dialog's inline error.
  async function runAction() {
    if (!action) return
    const { kind, ws } = action
    if (kind === 'stop') {
      await api.stopAdminWorkspace(ws.id)
      toast.success(t('components.admin.workspacesSection.toasts.stopped', { name: ws.name }))
    } else {
      await api.deleteAdminWorkspace(ws.id)
      toast.success(t('components.admin.workspacesSection.toasts.deleted', { name: ws.name }))
    }
    queryClient.invalidateQueries({ queryKey: ['admin-workspaces'] })
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
    col: AdminWorkspacesSort
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

  function renderRow(w: AdminWorkspace) {
    return (
      <TableRow key={w.id} className="group">
        <TableCell className="max-w-[16rem]">
          <span className="block truncate font-medium">{w.name}</span>
        </TableCell>
        <TableCell>
          <button
            type="button"
            onClick={() => {
              setOwner({ id: w.owner_id, name: w.owner })
              setPage(1)
            }}
            className="truncate text-muted-foreground hover:text-foreground hover:underline"
            title={t('components.admin.workspacesSection.filterByOwner')}
          >
            {w.owner}
          </button>
        </TableCell>
        <TableCell>
          <Badge variant={STATUS_VARIANT[w.status]} className="px-1.5 py-0 text-mini">
            {t(`components.admin.workspacesSection.status.${w.status}`)}
          </Badge>
        </TableCell>
        <TableCell className="text-muted-foreground">{w.agent_type || '—'}</TableCell>
        <TableCell className="text-right text-muted-foreground tabular-nums">
          {w.interactions.toLocaleString()}
        </TableCell>
        <TableCell className="text-right font-medium tabular-nums">
          {formatCompact(w.tokens)}
        </TableCell>
        <TableCell className="text-right text-muted-foreground tabular-nums">
          {w.last_active_at ? new Date(w.last_active_at).toLocaleDateString() : '—'}
        </TableCell>
        <TableCell className="text-right text-muted-foreground tabular-nums">
          {new Date(w.created_at).toLocaleDateString()}
        </TableCell>
        <TableCell className="text-right">
          <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            {w.status === 'running' && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                title={t('components.admin.workspacesSection.actions.stop')}
                onClick={() => setAction({ kind: 'stop', ws: w })}
              >
                <CircleStop className="h-3 w-3" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-destructive hover:text-destructive"
              title={t('components.admin.workspacesSection.actions.delete')}
              onClick={() => setAction({ kind: 'delete', ws: w })}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </TableCell>
      </TableRow>
    )
  }

  return (
    <>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative max-w-xs flex-1">
            <Search className="-translate-y-1/2 absolute top-1/2 left-2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('components.admin.workspacesSection.search.placeholder')}
              className="h-7 pl-7 text-xs"
            />
          </div>

          <Select
            value={status || 'all'}
            onValueChange={resetPageThen((v: string) =>
              setStatus(v === 'all' ? '' : (v as Status)),
            )}
          >
            <SelectTrigger className="h-7 w-28 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                {t('components.admin.workspacesSection.filters.allStatus')}
              </SelectItem>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`components.admin.workspacesSection.status.${s}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={agentType || 'all'}
            onValueChange={resetPageThen((v: string) => setAgentType(v === 'all' ? '' : v))}
          >
            <SelectTrigger className="h-7 w-40 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                {t('components.admin.workspacesSection.filters.allAgentTypes')}
              </SelectItem>
              {agentTypeOptions.map((a) => (
                <SelectItem key={a} value={a}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {owner && (
            <Badge variant="outline" className="h-7 gap-1 pr-1 pl-2 text-xs font-normal">
              {t('components.admin.workspacesSection.ownerChip', { name: owner.name })}
              <button
                type="button"
                onClick={() => {
                  setOwner(null)
                  setPage(1)
                }}
                className="rounded-sm p-0.5 hover:bg-muted"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Spinner />
          </div>
        ) : total === 0 ? (
          <div className="py-10 text-center text-xs text-muted-foreground">
            {t('components.admin.workspacesSection.empty.noWorkspaces')}
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
                      label={t('components.admin.workspacesSection.columns.name')}
                      col="name"
                    />
                    <TableHead>{t('components.admin.workspacesSection.columns.owner')}</TableHead>
                    <SortHeader
                      label={t('components.admin.workspacesSection.columns.status')}
                      col="status"
                    />
                    <TableHead>
                      {t('components.admin.workspacesSection.columns.agentType')}
                    </TableHead>
                    <SortHeader
                      label={t('components.admin.workspacesSection.columns.interactions')}
                      col="interactions"
                      numeric
                    />
                    <SortHeader
                      label={t('components.admin.workspacesSection.columns.tokens')}
                      col="tokens"
                      numeric
                    />
                    <SortHeader
                      label={t('components.admin.workspacesSection.columns.lastActive')}
                      col="last_active"
                      numeric
                    />
                    <SortHeader
                      label={t('components.admin.workspacesSection.columns.created')}
                      col="created"
                      numeric
                    />
                    <TableHead className="w-16" />
                  </TableRow>
                </TableHeader>
                <TableBody>{items.map(renderRow)}</TableBody>
              </Table>
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {t('components.admin.workspacesSection.pagination.total', { count: total })}
              </span>
              <div className="flex items-center gap-2">
                <span className="tabular-nums">
                  {t('components.admin.workspacesSection.pagination.page', { page, pageCount })}
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

      {action && (
        <ConfirmDialog
          open
          onOpenChange={(o) => {
            if (!o) setAction(null)
          }}
          title={t(
            action.kind === 'stop'
              ? 'components.admin.workspacesSection.stopDialog.title'
              : 'components.admin.workspacesSection.deleteDialog.title',
          )}
          description={t(
            action.kind === 'stop'
              ? 'components.admin.workspacesSection.stopDialog.description'
              : 'components.admin.workspacesSection.deleteDialog.description',
            { name: action.ws.name },
          )}
          confirmLabel={t(
            action.kind === 'stop'
              ? 'components.admin.workspacesSection.stopDialog.confirm'
              : 'components.admin.workspacesSection.deleteDialog.confirm',
          )}
          confirmVariant={action.kind === 'delete' ? 'destructive' : 'default'}
          confirmPhrase={action.kind === 'delete' ? action.ws.name : undefined}
          confirmPhraseLabel={
            action.kind === 'delete'
              ? t('components.admin.workspacesSection.deleteDialog.confirmLabel', {
                  name: action.ws.name,
                })
              : undefined
          }
          onConfirm={runAction}
        />
      )}
    </>
  )
}
