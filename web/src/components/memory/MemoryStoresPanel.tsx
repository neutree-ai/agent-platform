import { MasterSidebar } from '@/components/shell/master-sidebar/MasterSidebar'
import { AppHeaderButton } from '@/components/shell/windows/AppHeaderButton'
import { useAppHeaderSlot } from '@/components/shell/windows/AppWindow'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { ConfirmButton } from '@/components/ui/confirm-button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DocumentedDialog } from '@/components/ui/documented-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EmptyHero } from '@/components/ui/empty-hero'
import { EmptyIllustration } from '@/components/ui/empty-illustration'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Markdown } from '@/components/ui/markdown'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { SaveButton } from '@/components/ui/save-button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { getMemoryStoreDoc, getMemoryStoreDocsHint } from '@/docs/inline-help/memory-store-docs'
import { api } from '@/lib/api/client'
import type {
  ApiMemory,
  ApiMemoryStore,
  ApiMemoryStoreAttachment,
  MemoryAccess,
} from '@/lib/api/types'
import { formatRelativeTime } from '@/lib/relative-time'
import { cn } from '@/lib/utils'
import { useInstancePersistentState } from '@/stores/instance-state-store'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BookText,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

interface MemoryStoresPanelProps {
  instanceId: string
  /**
   * When set, scope the panel to a single workspace: sidebar shows only
   * stores attached to this ws, "+ New" auto-attaches the new store, and
   * an "Attach existing" header button lets the user pick from their other
   * stores. When omitted, the panel behaves as the global fleet view.
   */
  workspaceId?: string
}

const workspaceAttachmentsKey = (workspaceId: string) =>
  ['workspaces', workspaceId, 'memory-attachments'] as const

const storesKey = ['memory-stores'] as const
const storeAttachmentsKey = (storeId: string) => ['memory-stores', storeId, 'attachments'] as const
const memoriesKey = (storeId: string) => ['memory-stores', storeId, 'memories'] as const
const memoryKey = (storeId: string, path: string) =>
  ['memory-stores', storeId, 'memory', path] as const
const versionsKey = (storeId: string, path: string) =>
  ['memory-stores', storeId, 'versions', path] as const
const memoryVersionKey = (storeId: string, versionId: string) =>
  ['memory-stores', storeId, 'memory-version', versionId] as const

export function MemoryStoresPanel({ instanceId, workspaceId }: MemoryStoresPanelProps) {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const headerSlot = useAppHeaderSlot()
  const wsMode = !!workspaceId

  const { data: stores = [], isLoading: storesLoading } = useQuery({
    queryKey: storesKey,
    queryFn: () => api.listMemoryStores(),
  })

  // In ws mode we narrow the visible list to stores attached to this ws.
  // The query is gated on workspaceId; the global view skips it entirely.
  const { data: wsAttachments = [] } = useQuery({
    queryKey: workspaceId ? workspaceAttachmentsKey(workspaceId) : ['noop-ws-attachments'],
    queryFn: () => api.listWorkspaceMemoryAttachments(workspaceId as string),
    enabled: wsMode,
  })
  const attachedStoreIds = useMemo(
    () => new Set(wsAttachments.map((a) => a.store_id)),
    [wsAttachments],
  )

  const [selectedStoreId, setSelectedStoreId] = useInstancePersistentState<string | null>(
    instanceId,
    'selectedStoreId',
    () => null,
  )
  const [search, setSearch] = useState('')
  const [storeDialogOpen, setStoreDialogOpen] = useState(false)
  const [editingStore, setEditingStore] = useState<ApiMemoryStore | null>(null)

  // The list the sidebar actually renders: in ws mode it's the
  // attachment-filtered subset; in global mode every store the user owns.
  const visibleStores = useMemo(
    () => (wsMode ? stores.filter((s) => attachedStoreIds.has(s.id)) : stores),
    [stores, wsMode, attachedStoreIds],
  )

  // Drop selection if the (possibly filtered) list no longer contains it.
  useEffect(() => {
    if (
      selectedStoreId &&
      visibleStores.length &&
      !visibleStores.some((s) => s.id === selectedStoreId)
    ) {
      setSelectedStoreId(null)
    }
  }, [visibleStores, selectedStoreId, setSelectedStoreId])

  // ws mode has no sidebar, so the user can't click to select — auto-pick
  // the first attached store on mount, or after the previous selection is
  // dropped above.
  useEffect(() => {
    if (wsMode && !selectedStoreId && visibleStores.length > 0) {
      setSelectedStoreId(visibleStores[0].id)
    }
  }, [wsMode, selectedStoreId, visibleStores, setSelectedStoreId])

  const selectedStore = useMemo(
    () => visibleStores.find((s) => s.id === selectedStoreId) ?? null,
    [visibleStores, selectedStoreId],
  )

  const filteredStores = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return visibleStores
    return visibleStores.filter(
      (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
    )
  }, [visibleStores, search])

  function openCreateDialog() {
    setEditingStore(null)
    setStoreDialogOpen(true)
  }

  function openEditDialog(store: ApiMemoryStore) {
    setEditingStore(store)
    setStoreDialogOpen(true)
  }

  // ── ws-mode side actions ─────────────────────────────────────────────
  const attachExistingMut = useMutation({
    mutationFn: (storeId: string) =>
      api.attachMemoryStore(workspaceId as string, { store_id: storeId, access: 'read_write' }),
    onSuccess: (a) => {
      qc.invalidateQueries({ queryKey: workspaceAttachmentsKey(workspaceId as string) })
      qc.invalidateQueries({ queryKey: storeAttachmentsKey(a.store_id) })
      setSelectedStoreId(a.store_id)
      toast.success(t('components.memoryStores.toasts.attached'))
    },
    onError: (e) =>
      toast.error(
        e instanceof Error ? e.message : t('components.memoryStores.errors.attachFailed'),
      ),
  })
  // Stores the user owns but hasn't attached to this ws yet — feed the
  // header "Attach existing" picker.
  const unattachedStores = useMemo(
    () => (wsMode ? stores.filter((s) => !attachedStoreIds.has(s.id)) : []),
    [stores, wsMode, attachedStoreIds],
  )

  const detachFromWsMut = useMutation({
    mutationFn: (storeId: string) => api.detachMemoryStore(workspaceId as string, storeId),
    onSuccess: (_r, storeId) => {
      qc.invalidateQueries({ queryKey: workspaceAttachmentsKey(workspaceId as string) })
      qc.invalidateQueries({ queryKey: storeAttachmentsKey(storeId) })
      // Drop selection so the auto-pick effect can land on whatever's left.
      if (selectedStoreId === storeId) setSelectedStoreId(null)
      toast.success(t('components.memoryStores.toasts.detached'))
    },
    onError: (e) =>
      toast.error(
        e instanceof Error ? e.message : t('components.memoryStores.errors.detachFailed'),
      ),
  })

  return (
    <div className="flex h-full overflow-hidden">
      {headerSlot &&
        createPortal(
          <>
            <AppHeaderButton
              icon={RefreshCw}
              label={t('components.memoryStores.actions.refresh')}
              onClick={() => {
                // Catch-all: re-pull stores, the current store's memories,
                // and (in ws mode) the workspace's attachments. Agents can
                // write files in the background — this is the user's "did
                // it land yet" button.
                qc.invalidateQueries({ queryKey: storesKey })
                if (selectedStoreId) {
                  qc.invalidateQueries({ queryKey: memoriesKey(selectedStoreId) })
                  qc.invalidateQueries({ queryKey: storeAttachmentsKey(selectedStoreId) })
                }
                if (wsMode) {
                  qc.invalidateQueries({
                    queryKey: workspaceAttachmentsKey(workspaceId as string),
                  })
                }
              }}
            />
            {wsMode && unattachedStores.length > 0 && (
              <AttachExistingStorePicker
                stores={unattachedStores}
                disabled={attachExistingMut.isPending}
                onPick={(storeId) => attachExistingMut.mutate(storeId)}
              />
            )}
            <AppHeaderButton
              icon={Plus}
              label={t('components.memoryStores.actions.newStore')}
              onClick={openCreateDialog}
            />
          </>,
          headerSlot,
        )}

      {/* ── Left: Store list (fleet mode only — ws mode swaps the sidebar
              for a Select in the detail header to save width) ── */}
      {!wsMode && (
        <MasterSidebar width="md">
          <MasterSidebar.Search value={search} onChange={setSearch} />
          <MasterSidebar.List>
            {storesLoading && stores.length === 0 ? (
              <div className="flex h-24 items-center justify-center">
                <Spinner size="sm" />
              </div>
            ) : filteredStores.length === 0 ? (
              <MasterSidebar.Empty>
                {search
                  ? t('components.workspaceChat.empty.noMatches')
                  : t('components.memoryStores.empty.stores')}
              </MasterSidebar.Empty>
            ) : (
              filteredStores.map((store) => (
                <MasterSidebar.Item
                  key={store.id}
                  selected={selectedStoreId === store.id}
                  onSelect={() => setSelectedStoreId(store.id)}
                >
                  {store.name}
                </MasterSidebar.Item>
              ))
            )}
          </MasterSidebar.List>
        </MasterSidebar>
      )}

      {/* ── Right: Detail ── */}
      <div className="flex min-h-0 flex-1 flex-col">
        {selectedStore ? (
          <StoreDetail
            store={selectedStore}
            instanceId={instanceId}
            locale={i18n.language}
            wsMode={wsMode}
            attachedStores={wsMode ? visibleStores : undefined}
            onSelectStore={wsMode ? (id) => setSelectedStoreId(id) : undefined}
            onDetachFromWs={wsMode ? () => detachFromWsMut.mutate(selectedStore.id) : undefined}
            onEdit={() => openEditDialog(selectedStore)}
            onDeleted={() => {
              setSelectedStoreId(null)
              qc.invalidateQueries({ queryKey: storesKey })
              if (wsMode) {
                qc.invalidateQueries({
                  queryKey: workspaceAttachmentsKey(workspaceId as string),
                })
              }
            }}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <EmptyHero
              illustration={<EmptyIllustration src="memory" />}
              title={
                wsMode
                  ? visibleStores.length === 0
                    ? t('components.memoryStores.empty.wsNoAttachmentsTitle')
                    : t('components.memoryStores.empty.noSelection.title')
                  : stores.length === 0
                    ? t('components.memoryStores.empty.stores')
                    : t('components.memoryStores.empty.noSelection.title')
              }
              description={
                wsMode
                  ? t('components.memoryStores.empty.wsNoAttachmentsDescription')
                  : t('components.memoryStores.empty.noSelection.description')
              }
              action={
                <Button size="sm" onClick={openCreateDialog}>
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  {t('components.memoryStores.actions.newStore')}
                </Button>
              }
            />
          </div>
        )}
      </div>

      <StoreDialog
        open={storeDialogOpen}
        onOpenChange={setStoreDialogOpen}
        editing={editingStore}
        onSaved={async (store) => {
          setStoreDialogOpen(false)
          // In ws mode we auto-attach the newly created store so the user
          // doesn't have to swap to the global view and attach manually.
          // Editing an existing store skips this step.
          if (wsMode && editingStore == null) {
            try {
              await api.attachMemoryStore(workspaceId as string, {
                store_id: store.id,
                access: 'read_write',
              })
              qc.invalidateQueries({
                queryKey: workspaceAttachmentsKey(workspaceId as string),
              })
              qc.invalidateQueries({ queryKey: storeAttachmentsKey(store.id) })
            } catch (e) {
              toast.error(
                e instanceof Error ? e.message : t('components.memoryStores.errors.attachFailed'),
              )
            }
          }
          setSelectedStoreId(store.id)
        }}
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

interface AttachExistingStorePickerProps {
  stores: ApiMemoryStore[]
  disabled?: boolean
  onPick: (storeId: string) => void
}

// Header-button popover used in ws mode to attach a store the user already
// owns elsewhere. Mirrors the AttachWorkspacePicker shape (cmdk Command
// inside a Popover), narrowed to a single column — no access toggle here
// because we default to read_write; users can flip the chip after.
function AttachExistingStorePicker({ stores, disabled, onPick }: AttachExistingStorePickerProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <AppHeaderButton
          icon={Plus}
          label={t('components.memoryStores.actions.attachExisting')}
          onClick={() => setOpen((v) => !v)}
          disabled={disabled}
        />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 overflow-hidden p-0">
        <Command>
          <CommandInput
            placeholder={t('components.memoryStores.attachPicker.searchStores')}
            className="h-8 text-xs"
          />
          <CommandList className="max-h-72 overflow-y-auto">
            <CommandEmpty className="py-3 text-xs">
              {t('components.memoryStores.attachPicker.emptyStores')}
            </CommandEmpty>
            {stores.map((s) => (
              <CommandItem
                key={s.id}
                value={s.name}
                onSelect={() => {
                  onPick(s.id)
                  setOpen(false)
                }}
                className="flex-col items-start gap-0.5 text-xs"
              >
                <span className="truncate font-medium">{s.name}</span>
                {s.description && (
                  <span className="truncate text-tiny text-muted-foreground">{s.description}</span>
                )}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

interface StoreDetailProps {
  store: ApiMemoryStore
  instanceId: string
  locale: string
  /** ws mode replaces the sidebar with an in-header Select; pass the
      attached store list and a setter so the user can still switch. */
  wsMode?: boolean
  attachedStores?: ApiMemoryStore[]
  onSelectStore?: (storeId: string) => void
  /** ws mode: detach the current store from this workspace. The handler
      owns the API call + invalidation; StoreDetail just wires the menu. */
  onDetachFromWs?: () => void
  onEdit: () => void
  onDeleted: () => void
}

function StoreDetail({
  store,
  instanceId,
  locale,
  wsMode,
  attachedStores,
  onSelectStore,
  onDetachFromWs,
  onEdit,
  onDeleted,
}: StoreDetailProps) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [newMemoryNonce, setNewMemoryNonce] = useState(0)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const deleteStore = useMutation({
    mutationFn: () => api.deleteMemoryStore(store.id),
    onSuccess: () => {
      setConfirmDelete(false)
      toast.success(t('components.memoryStores.toasts.storeDeleted'))
      onDeleted()
    },
    onError: (e) =>
      toast.error(
        e instanceof Error ? e.message : t('components.memoryStores.errors.deleteFailed'),
      ),
  })

  const { data: attachments = [] } = useQuery({
    queryKey: storeAttachmentsKey(store.id),
    queryFn: () => api.listMemoryStoreAttachments(store.id),
  })

  // ws mode with ≥2 attached stores swaps the static name for a Select so
  // the user can switch within the workspace view (the sidebar that would
  // normally do this is hidden in ws mode).
  const showStoreSwitcher = wsMode && attachedStores && attachedStores.length >= 2

  return (
    <>
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <div className="min-w-0 flex-1">
          {showStoreSwitcher ? (
            <Select value={store.id} onValueChange={(v) => onSelectStore?.(v)}>
              <SelectTrigger className="h-7 w-auto min-w-0 max-w-full gap-1 border-0 bg-transparent px-0 text-sm font-semibold shadow-none focus:ring-0 [&>span]:truncate">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {attachedStores?.map((s) => (
                  <SelectItem key={s.id} value={s.id} className="text-xs">
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <h2 className="truncate text-sm font-semibold">{store.name}</h2>
          )}
          {store.description && (
            <p className="truncate text-xs text-muted-foreground">{store.description}</p>
          )}
          <StoreStatsStrip
            memoryCount={store.memory_count}
            attachmentCount={attachments.length}
            updatedAt={store.updated_at}
            locale={locale}
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          onClick={() => setNewMemoryNonce((n) => n + 1)}
        >
          <Plus className="h-3 w-3" />
          {t('components.memoryStores.actions.newMemory')}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7">
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="mr-2 h-3 w-3" />
              {t('components.memoryStores.actions.editStore')}
            </DropdownMenuItem>
            {wsMode && onDetachFromWs && (
              <DropdownMenuItem onClick={onDetachFromWs}>
                <X className="mr-2 h-3 w-3" />
                {t('components.memoryStores.actions.detachFromWs')}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              disabled={attachments.length > 0}
              onClick={() => setConfirmDelete(true)}
              title={
                attachments.length > 0
                  ? t('components.memoryStores.actions.deleteStoreBlocked', {
                      count: attachments.length,
                    })
                  : undefined
              }
            >
              <Trash2 className="mr-2 h-3 w-3" />
              {t('components.memoryStores.actions.deleteStore')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {/* "Attached to: ws_a, ws_b" is redundant inside a single ws view —
          you're already looking at one of those ws. Hide in ws mode. */}
      {!wsMode && <StoreAttachmentsBar store={store} qc={qc} />}
      <div className="flex min-h-0 flex-1">
        <MemoriesPane
          store={store}
          instanceId={instanceId}
          locale={locale}
          qc={qc}
          newMemoryNonce={newMemoryNonce}
        />
      </div>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('components.memoryStores.actions.deleteStore')}</DialogTitle>
            <DialogDescription>
              {t('components.memoryStores.dialog.deleteConfirm', { name: store.name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
              {t('components.memoryStores.actions.cancel')}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={deleteStore.isPending}
              onClick={() => deleteStore.mutate()}
            >
              {t('components.memoryStores.actions.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

interface StoreAttachmentsBarProps {
  store: ApiMemoryStore
  qc: ReturnType<typeof useQueryClient>
}

// Compact bar showing which workspaces this store is attached to, with
// inline attach / detach controls. Lives between the store header and the
// memories tree so the user can manage cross-ws mounts without leaving the
// Memory app.
function StoreAttachmentsBar({ store, qc }: StoreAttachmentsBarProps) {
  const { t } = useTranslation()
  const { data: attached = [] } = useQuery({
    queryKey: storeAttachmentsKey(store.id),
    queryFn: () => api.listMemoryStoreAttachments(store.id),
  })
  const { data: workspaces = [] } = useQuery({
    queryKey: ['memory-stores-ws-picker'],
    queryFn: () => api.getWorkspaces(),
  })
  const attachedIds = new Set(attached.map((a) => a.workspace_id))
  const unattached = workspaces.filter((w) => !attachedIds.has(w.id))

  const invalidate = () => qc.invalidateQueries({ queryKey: storeAttachmentsKey(store.id) })

  const attachMut = useMutation({
    mutationFn: ({ workspaceId, access }: { workspaceId: string; access: MemoryAccess }) =>
      api.attachMemoryStore(workspaceId, { store_id: store.id, access }),
    onSuccess: () => {
      invalidate()
      toast.success(t('components.memoryStores.toasts.attached'))
    },
    onError: (e) =>
      toast.error(
        e instanceof Error ? e.message : t('components.memoryStores.errors.attachFailed'),
      ),
  })
  const detachMut = useMutation({
    mutationFn: (workspaceId: string) => api.detachMemoryStore(workspaceId, store.id),
    onSuccess: () => {
      invalidate()
      toast.success(t('components.memoryStores.toasts.detached'))
    },
    onError: (e) =>
      toast.error(
        e instanceof Error ? e.message : t('components.memoryStores.errors.detachFailed'),
      ),
  })
  const patchAccessMut = useMutation({
    mutationFn: ({ workspaceId, access }: { workspaceId: string; access: MemoryAccess }) =>
      api.patchMemoryAttachment(workspaceId, store.id, { access }),
    onSuccess: () => {
      invalidate()
      toast.success(t('components.memoryStores.toasts.accessUpdated'))
    },
    onError: (e) =>
      toast.error(
        e instanceof Error ? e.message : t('components.memoryStores.errors.accessUpdateFailed'),
      ),
  })

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b px-4 py-1.5 text-xs">
      <span className="text-muted-foreground">
        {t('components.memoryStores.labels.attachedTo')}
      </span>
      {attached.length === 0 && (
        <span className="text-muted-foreground/60">
          {t('components.memoryStores.labels.noAttachments')}
        </span>
      )}
      {attached.map((a) => (
        <AttachmentChip
          key={a.workspace_id}
          attachment={a}
          onDetach={() => detachMut.mutate(a.workspace_id)}
          onAccessChange={(access) =>
            patchAccessMut.mutate({ workspaceId: a.workspace_id, access })
          }
          disabled={detachMut.isPending || patchAccessMut.isPending}
        />
      ))}
      {unattached.length > 0 && (
        <AttachWorkspacePicker
          workspaces={unattached}
          disabled={attachMut.isPending}
          onPick={(workspaceId, access) => attachMut.mutate({ workspaceId, access })}
        />
      )}
    </div>
  )
}

interface AttachWorkspacePickerProps {
  workspaces: Array<{ id: string; name: string }>
  disabled?: boolean
  onPick: (workspaceId: string, access: MemoryAccess) => void
}

function AttachWorkspacePicker({ workspaces, disabled, onPick }: AttachWorkspacePickerProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [access, setAccess] = useState<MemoryAccess>('read_write')

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 gap-0.5 px-1.5 text-xs"
          disabled={disabled}
        >
          <Plus className="h-2.5 w-2.5" />
          {t('components.memoryStores.actions.attach')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 overflow-hidden p-0">
        <div className="flex items-center justify-between gap-2 border-b px-2 py-1.5 text-tiny">
          <span className="text-muted-foreground">
            {t('components.memoryStores.attachPicker.accessLabel')}
          </span>
          <div className="flex rounded-md border bg-background p-0.5">
            {(['read_write', 'read_only'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setAccess(mode)}
                className={cn(
                  'rounded-sm px-2 py-0.5 text-tiny font-medium transition-colors',
                  access === mode
                    ? 'bg-foreground/10 text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {mode === 'read_write'
                  ? t('components.memoryStores.access.readWrite')
                  : t('components.memoryStores.access.readOnly')}
              </button>
            ))}
          </div>
        </div>
        <Command>
          <CommandInput
            placeholder={t('components.memoryStores.attachPicker.search')}
            className="h-8 text-xs"
          />
          <CommandList className="max-h-60 overflow-y-auto">
            <CommandEmpty className="py-3 text-xs">
              {t('components.memoryStores.attachPicker.empty')}
            </CommandEmpty>
            {workspaces.map((ws) => (
              <CommandItem
                key={ws.id}
                value={ws.name}
                onSelect={() => {
                  onPick(ws.id, access)
                  setOpen(false)
                }}
                className="text-xs"
              >
                {ws.name}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

interface AttachmentChipProps {
  attachment: ApiMemoryStoreAttachment
  onDetach: () => void
  onAccessChange: (access: MemoryAccess) => void
  disabled?: boolean
}

function AttachmentChip({ attachment, onDetach, onAccessChange, disabled }: AttachmentChipProps) {
  const { t } = useTranslation()
  const [accessOpen, setAccessOpen] = useState(false)
  return (
    <Badge variant="secondary" className="h-5 gap-1 pr-0.5 text-tiny">
      <span>{attachment.workspace_name}</span>
      <Popover open={accessOpen} onOpenChange={setAccessOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="rounded-sm px-0.5 text-muted-foreground/70 hover:bg-foreground/10 hover:text-foreground disabled:opacity-50"
            disabled={disabled}
            title={t('components.memoryStores.actions.changeAccess')}
          >
            {attachment.access === 'read_only'
              ? t('components.memoryStores.access.readOnly')
              : t('components.memoryStores.access.readWrite')}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-1">
          <div className="flex rounded-md border bg-background p-0.5">
            {(['read_write', 'read_only'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  if (mode !== attachment.access) onAccessChange(mode)
                  setAccessOpen(false)
                }}
                className={cn(
                  'rounded-sm px-2 py-0.5 text-tiny font-medium transition-colors',
                  attachment.access === mode
                    ? 'bg-foreground/10 text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {mode === 'read_write'
                  ? t('components.memoryStores.access.readWrite')
                  : t('components.memoryStores.access.readOnly')}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      <button
        type="button"
        className="ml-0.5 rounded-sm px-0.5 hover:bg-destructive/20 disabled:opacity-50"
        onClick={onDetach}
        disabled={disabled}
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </Badge>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

interface MemoriesPaneProps {
  store: ApiMemoryStore
  instanceId: string
  locale: string
  qc: ReturnType<typeof useQueryClient>
  /** Bumped by the parent's "+ New memory" button to enter create mode from outside the pane. */
  newMemoryNonce: number
}

function MemoriesPane({ store, instanceId, locale, qc, newMemoryNonce }: MemoriesPaneProps) {
  const { t } = useTranslation()
  const { data: memories = [], isLoading } = useQuery({
    queryKey: memoriesKey(store.id),
    queryFn: () => api.listMemoriesInStore(store.id),
  })
  const [selectedPath, setSelectedPath] = useInstancePersistentState<string | null>(
    instanceId,
    `selectedPath:${store.id}`,
    () => null,
  )
  const [creating, setCreating] = useState(false)
  const [collapsedDirs, setCollapsedDirs] = useInstancePersistentState<Record<string, boolean>>(
    instanceId,
    `collapsedDirs:${store.id}`,
    () => ({}),
  )

  // Drop stale path when store contents change.
  useEffect(() => {
    if (selectedPath && memories.length && !memories.some((m) => m.path === selectedPath)) {
      setSelectedPath(null)
    }
  }, [memories, selectedPath, setSelectedPath])

  // Parent's "+ New memory" button bumps newMemoryNonce → enter create mode.
  // biome-ignore lint/correctness/useExhaustiveDependencies: react only to nonce changes.
  useEffect(() => {
    if (newMemoryNonce > 0) {
      setCreating(true)
      setSelectedPath(null)
    }
  }, [newMemoryNonce])

  const tree = useMemo(
    () => buildTree(memories.map((m) => ({ path: m.path, updatedAt: m.updated_at }))),
    [memories],
  )

  // Auto-expand the chain leading to the selected path so it's always visible.
  const forceExpanded = useMemo(() => {
    const set = new Set<string>()
    if (!selectedPath) return set
    const parts = selectedPath.split('/').filter(Boolean)
    let acc = ''
    for (let i = 0; i < parts.length - 1; i++) {
      acc += `/${parts[i]}`
      set.add(acc)
    }
    return set
  }, [selectedPath])

  const toggleDir = (dirPath: string) => {
    setCollapsedDirs((prev) => {
      const next = { ...prev }
      if (next[dirPath]) delete next[dirPath]
      else next[dirPath] = true
      return next
    })
  }

  return (
    <>
      <div className="flex w-72 shrink-0 flex-col border-r">
        <ScrollArea className="flex-1">
          {isLoading && memories.length === 0 ? (
            <div className="flex h-24 items-center justify-center">
              <Spinner size="sm" />
            </div>
          ) : memories.length === 0 && !creating ? (
            <div className="px-3 py-4 text-xs text-muted-foreground">
              {t('components.memoryStores.empty.memories')}
            </div>
          ) : (
            <TreeView
              nodes={tree}
              depth={0}
              selectedPath={creating ? null : selectedPath}
              collapsedDirs={collapsedDirs}
              forceExpanded={forceExpanded}
              locale={locale}
              onToggle={toggleDir}
              onSelect={(p) => {
                setSelectedPath(p)
                setCreating(false)
              }}
            />
          )}
        </ScrollArea>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {creating ? (
          <MemoryEditor
            mode="create"
            storeId={store.id}
            onSaved={(m) => {
              setCreating(false)
              setSelectedPath(m.path)
              qc.invalidateQueries({ queryKey: memoriesKey(store.id) })
            }}
            onCancel={() => setCreating(false)}
          />
        ) : selectedPath ? (
          <MemoryViewer
            storeId={store.id}
            path={selectedPath}
            locale={locale}
            onDeleted={() => {
              setSelectedPath(null)
              qc.invalidateQueries({ queryKey: memoriesKey(store.id) })
            }}
            onSaved={() => {
              qc.invalidateQueries({ queryKey: memoriesKey(store.id) })
            }}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
            {t('components.memoryStores.empty.noMemorySelection')}
          </div>
        )}
      </div>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

interface MemoryViewerProps {
  storeId: string
  path: string
  locale: string
  onDeleted: () => void
  onSaved: () => void
}

function MemoryViewer({ storeId, path, locale, onDeleted, onSaved }: MemoryViewerProps) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data: memory, isLoading } = useQuery({
    queryKey: memoryKey(storeId, path),
    queryFn: () => api.getMemory(storeId, path),
  })
  const [editing, setEditing] = useState(false)

  // Version list is small per path — fetch eagerly so the dropdown shows
  // "v3" instead of "v?" before it's first opened. Picked version's content
  // is still loaded on demand.
  const [previewVersionId, setPreviewVersionId] = useState<string | null>(null)
  const versionsQuery = useQuery({
    queryKey: versionsKey(storeId, path),
    queryFn: () => api.listMemoryVersions(storeId, { path, limit: 200 }),
  })
  const versions = versionsQuery.data ?? []
  const previewQuery = useQuery({
    queryKey: previewVersionId ? memoryVersionKey(storeId, previewVersionId) : ['noop'],
    queryFn: () => api.getMemoryVersion(storeId, previewVersionId as string),
    enabled: !!previewVersionId,
  })
  const previewVersion = previewQuery.data ?? null

  // Drop preview when path changes.
  useEffect(() => {
    setPreviewVersionId(null)
  }, [path])

  const deleteMutation = useMutation({
    mutationFn: () =>
      api.deleteMemory(storeId, path, memory ? { if_match_sha256: memory.content_sha256 } : {}),
    onSuccess: () => {
      toast.success(t('components.memoryStores.toasts.memoryDeleted'))
      qc.removeQueries({ queryKey: memoryKey(storeId, path) })
      onDeleted()
    },
    onError: (e) =>
      toast.error(
        e instanceof Error ? e.message : t('components.memoryStores.errors.deleteFailed'),
      ),
  })

  const rollbackMutation = useMutation({
    mutationFn: (versionId: string) => api.rollbackMemory(storeId, versionId),
    onSuccess: () => {
      const v = previewVersion?.version_number
      toast.success(t('components.memoryStores.toasts.rolledBack', { version: v }))
      setPreviewVersionId(null)
      qc.invalidateQueries({ queryKey: memoryKey(storeId, path) })
      qc.invalidateQueries({ queryKey: versionsKey(storeId, path) })
      onSaved()
    },
    onError: (e) =>
      toast.error(
        e instanceof Error ? e.message : t('components.memoryStores.errors.rollbackFailed'),
      ),
  })

  if (isLoading || !memory) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner size="sm" />
      </div>
    )
  }

  if (editing) {
    return (
      <MemoryEditor
        mode="edit"
        storeId={storeId}
        memory={memory}
        onSaved={() => {
          setEditing(false)
          qc.invalidateQueries({ queryKey: memoryKey(storeId, path) })
          qc.invalidateQueries({ queryKey: versionsKey(storeId, path) })
          onSaved()
        }}
        onCancel={() => setEditing(false)}
      />
    )
  }

  // Latest version sits at the top of the dropdown list (versions are returned
  // newest-first); we treat the most recent non-delete write as "current".
  const currentVersion = versions[0] ?? null
  const isPreviewing = previewVersion && previewVersion.id !== currentVersion?.id
  const displayContent = isPreviewing ? (previewVersion.content ?? '') : memory.content

  return (
    <>
      <div className="flex items-center gap-2 border-b px-4 py-1.5">
        <code className="min-w-0 flex-1 truncate text-xs">{memory.path}</code>
        <Select
          value={previewVersionId ?? currentVersion?.id ?? ''}
          onValueChange={(val) => {
            if (!currentVersion || val === currentVersion.id) {
              setPreviewVersionId(null)
            } else {
              setPreviewVersionId(val)
            }
          }}
        >
          <SelectTrigger className="h-6 w-auto gap-1 border-0 bg-foreground/[0.06] px-2 text-tiny shadow-none focus:ring-0">
            <SelectValue placeholder="v?" />
          </SelectTrigger>
          <SelectContent>
            {versionsQuery.isLoading ? (
              <div className="flex justify-center py-2">
                <Spinner size="sm" />
              </div>
            ) : versions.length === 0 ? (
              currentVersion ? (
                <SelectItem value={currentVersion.id} className="text-xs">
                  v{currentVersion.version_number ?? 1}
                </SelectItem>
              ) : null
            ) : (
              versions.map((v) => (
                <SelectItem key={v.id} value={v.id} className="text-xs">
                  v{v.version_number ?? '?'} · {v.operation} ·{' '}
                  {formatRelativeTime(v.created_at, locale)}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
        {isPreviewing && previewVersion.operation !== 'delete' && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            disabled={rollbackMutation.isPending}
            onClick={() => rollbackMutation.mutate(previewVersion.id)}
          >
            <RotateCcw className="h-3 w-3" />
            {t('components.memoryStores.actions.rollbackTo', {
              version: previewVersion.version_number,
            })}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setEditing(true)}
          disabled={!!isPreviewing}
          title={t('components.memoryStores.actions.edit')}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <ConfirmButton
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          icon={<Trash2 className="h-3.5 w-3.5" />}
          tooltip={t('components.memoryStores.actions.delete')}
          disabled={!!isPreviewing}
          onConfirm={() => deleteMutation.mutate()}
        />
      </div>
      <ScrollArea className="flex-1 px-4 py-3">
        <MemoryRenderer content={displayContent} path={memory.path} />
      </ScrollArea>
    </>
  )
}

interface MemoryRendererProps {
  content: string
  path: string
}

function MemoryRenderer({ content, path }: MemoryRendererProps) {
  const { t } = useTranslation()
  const indexMode = isIndexPath(path)
  const { meta, body } = useMemo(
    () => (indexMode ? { meta: null, body: content } : parseFrontmatter(content)),
    [content, indexMode],
  )
  return (
    <>
      {indexMode ? (
        <div className="mb-3 flex items-start gap-2 rounded-md border bg-info/10 px-2 py-1.5">
          <BookText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium">{t('components.memoryStores.index.label')}</div>
            <div className="mt-0.5 text-tiny text-muted-foreground">
              {t('components.memoryStores.index.hint')}
            </div>
          </div>
        </div>
      ) : meta ? (
        <FrontmatterStrip meta={meta} />
      ) : (
        <div className="mb-2 rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-tiny text-warning">
          {t('components.memoryStores.frontmatter.missing')}
        </div>
      )}
      <Markdown>{body}</Markdown>
    </>
  )
}

interface FrontmatterStripProps {
  meta: MemoryFrontmatter
}

function FrontmatterStrip({ meta }: FrontmatterStripProps) {
  const { t } = useTranslation()
  const parts: Array<{ label: string; value: string }> = []
  if (meta.type)
    parts.push({
      label: t('components.memoryStores.frontmatter.type'),
      value: t(`components.memoryStores.frontmatter.types.${meta.type}`),
    })
  if (meta.created)
    parts.push({ label: t('components.memoryStores.frontmatter.created'), value: meta.created })
  return (
    <div className="mb-3 rounded-md border bg-muted/30 px-2 py-1.5">
      {meta.name && <div className="text-xs font-medium">{meta.name}</div>}
      {meta.description && (
        <div className="mt-0.5 text-tiny text-muted-foreground">{meta.description}</div>
      )}
      {parts.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-2 text-tiny text-muted-foreground/70">
          {parts.map((p) => (
            <span key={p.label}>
              <span className="font-medium">{p.label}:</span> {p.value}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

interface MemoryEditorProps {
  mode: 'create' | 'edit'
  storeId: string
  memory?: ApiMemory
  onSaved: (memory: ApiMemory) => void
  onCancel: () => void
}

function MemoryEditor({ mode, storeId, memory, onSaved, onCancel }: MemoryEditorProps) {
  const { t } = useTranslation()

  // The index file (`/MEMORY.md`) is agent-maintained and never carries
  // frontmatter — we treat it as raw markdown so neither the form fields nor
  // the validator apply.
  const indexMode = !!memory && isIndexPath(memory.path)

  // Always present the editor as: structured frontmatter form + raw body
  // textarea. On open we split existing content; on save we serialize back.
  // Missing frontmatter on an existing memory still parses to defaults +
  // full content as body, so the next save will write proper schema.
  //
  // `created` is a system-managed timestamp — set once on create, displayed
  // read-only on edit. `path` derives from `name` on create (`/<name>.md`)
  // and is immutable thereafter, shown read-only on edit.
  const initial = useMemo(() => {
    if (!memory) {
      return {
        name: '',
        description: '',
        type: 'feedback' as MemoryType,
        created: todayIso(),
        body: '',
      }
    }
    if (isIndexPath(memory.path)) {
      return {
        name: 'MEMORY',
        description: '',
        type: 'feedback' as MemoryType,
        created: todayIso(),
        body: memory.content,
      }
    }
    const parsed = parseFrontmatter(memory.content)
    return {
      name: parsed.meta?.name ?? slugFromPath(memory.path),
      description: parsed.meta?.description ?? '',
      type: parsed.meta?.type ?? ('feedback' as MemoryType),
      created: parsed.meta?.created ?? todayIso(),
      body: parsed.meta ? parsed.body : memory.content,
    }
  }, [memory])

  const [name, setName] = useState(initial.name)
  const [description, setDescription] = useState(initial.description)
  const [type, setType] = useState<MemoryType>(initial.type)
  const [body, setBody] = useState(initial.body)
  const [error, setError] = useState<string | null>(null)

  const trimmedName = name.trim()
  // Filename-safe slug: lowercase alphanumerics + hyphens, must start with an
  // alphanumeric. Enforced because `name` becomes the filename on create
  // (`/<name>.md`) and the FUSE mount surfaces it to the agent.
  const nameValid = trimmedName === '' || /^[a-z0-9][a-z0-9-]*$/.test(trimmedName)

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (indexMode && memory) {
        return api.putMemory(storeId, memory.path, {
          content: body,
          if_match_sha256: memory.content_sha256,
        })
      }
      if (!trimmedName) throw new Error(t('components.memoryStores.errors.nameRequired'))
      if (!nameValid) throw new Error(t('components.memoryStores.frontmatter.nameInvalid'))
      // On create, derive the storage path from the user-visible name so they
      // only have one identifier to think about. Existing memories keep their
      // path — even if the user edits the displayed name.
      const targetPath = memory?.path ?? `/${trimmedName}.md`
      const content = serializeMemory(
        { name: trimmedName, description, type, created: initial.created },
        body,
      )
      return api.putMemory(storeId, targetPath, {
        content,
        if_match_sha256: memory?.content_sha256,
      })
    },
    onSuccess: (m) => {
      toast.success(
        mode === 'create'
          ? t('components.memoryStores.toasts.memoryCreated')
          : t('components.memoryStores.toasts.memorySaved'),
      )
      onSaved(m)
    },
    onError: (e) =>
      setError(e instanceof Error ? e.message : t('components.memoryStores.errors.saveFailed')),
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 px-4 py-3">
      {indexMode && (
        <div className="flex items-start gap-2 rounded-md border bg-info/10 px-2 py-1.5">
          <BookText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium">{t('components.memoryStores.index.label')}</div>
            <div className="mt-0.5 text-tiny text-muted-foreground">
              {t('components.memoryStores.index.editHint')}
            </div>
          </div>
        </div>
      )}
      {!indexMode && (
        <>
          <div className="flex items-start gap-2">
            <Label
              htmlFor="mem-name"
              className="w-20 shrink-0 pt-1.5 text-xs text-muted-foreground"
            >
              {t('components.memoryStores.frontmatter.name')}
            </Label>
            <div className="flex-1">
              <Input
                id="mem-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('components.memoryStores.frontmatter.namePlaceholder')}
                aria-invalid={!nameValid || undefined}
                className="h-7 font-mono text-xs aria-invalid:border-destructive"
              />
              {!nameValid && (
                <p className="mt-0.5 text-tiny text-destructive">
                  {t('components.memoryStores.frontmatter.nameInvalid')}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Label
              htmlFor="mem-desc"
              className="w-20 shrink-0 pt-1.5 text-xs text-muted-foreground"
            >
              {t('components.memoryStores.frontmatter.description')}
            </Label>
            <Textarea
              id="mem-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('components.memoryStores.frontmatter.descriptionPlaceholder')}
              className="min-h-[2.25rem] flex-1 resize-none text-xs"
              rows={2}
            />
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="mem-type" className="w-20 shrink-0 text-xs text-muted-foreground">
              {t('components.memoryStores.frontmatter.type')}
            </Label>
            <Select value={type} onValueChange={(v) => setType(v as MemoryType)}>
              <SelectTrigger id="mem-type" className="h-7 w-40 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MEMORY_TYPES.map((mt) => (
                  <SelectItem key={mt} value={mt} className="text-xs">
                    {t(`components.memoryStores.frontmatter.types.${mt}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {mode === 'edit' && (
              <span className="ml-2 text-tiny text-muted-foreground/70">
                <span className="font-medium">
                  {t('components.memoryStores.frontmatter.created')}:
                </span>{' '}
                {initial.created}
              </span>
            )}
          </div>
        </>
      )}
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={
          indexMode
            ? t('components.memoryStores.index.bodyPlaceholder')
            : t('components.memoryStores.placeholders.content')
        }
        className="min-h-0 flex-1 resize-none font-mono text-xs"
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t('components.memoryStores.actions.cancel')}
        </Button>
        <SaveButton
          size="sm"
          isSaving={saveMutation.isPending}
          label={t('components.memoryStores.actions.save')}
          onClick={() => {
            setError(null)
            saveMutation.mutate()
          }}
        />
      </div>
    </div>
  )
}

function serializeMemory(
  meta: { name: string; description: string; type: MemoryType; created: string },
  body: string,
): string {
  const lines = [
    '---',
    `name: ${meta.name.trim()}`,
    `description: ${meta.description.trim()}`,
    'metadata:',
    `  type: ${meta.type}`,
    `  created: ${meta.created.trim()}`,
    '---',
    '',
  ]
  return `${lines.join('\n')}${body}`
}

// ─────────────────────────────────────────────────────────────────────────────

interface StoreDialogProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  editing: ApiMemoryStore | null
  onSaved: (store: ApiMemoryStore) => void
}

function StoreDialog({ open, onOpenChange, editing, onSaved }: StoreDialogProps) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const isEdit = editing !== null

  // Reset form when dialog opens.
  useEffect(() => {
    if (!open) return
    setName(editing?.name ?? '')
    setDescription(editing?.description ?? '')
    setError(null)
  }, [open, editing])

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error(t('components.memoryStores.errors.nameRequired'))
      if (isEdit) {
        return api.patchMemoryStore(editing.id, {
          name: name.trim(),
          description: description.trim(),
        })
      }
      return api.createMemoryStore({
        name: name.trim(),
        description: description.trim() || undefined,
      })
    },
    onSuccess: (store) => {
      toast.success(
        isEdit
          ? t('components.memoryStores.toasts.storeSaved')
          : t('components.memoryStores.toasts.storeCreated'),
      )
      qc.invalidateQueries({ queryKey: storesKey })
      onSaved(store)
    },
    onError: (e) =>
      setError(e instanceof Error ? e.message : t('components.memoryStores.errors.saveFailed')),
  })

  const footer = (
    <>
      <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
        {t('components.memoryStores.actions.cancel')}
      </Button>
      <SaveButton
        size="sm"
        isSaving={saveMutation.isPending}
        label={
          isEdit
            ? t('components.memoryStores.actions.save')
            : t('components.memoryStores.actions.create')
        }
        onClick={() => {
          setError(null)
          saveMutation.mutate()
        }}
      />
    </>
  )

  return (
    <DocumentedDialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        isEdit
          ? t('components.memoryStores.dialog.editTitle')
          : t('components.memoryStores.dialog.createTitle')
      }
      docs={getMemoryStoreDoc()}
      docsHint={getMemoryStoreDocsHint()}
      size="md"
      footer={footer}
    >
      <div className="space-y-3 py-2">
        <div className="space-y-1.5">
          <Label htmlFor="store-name" className="text-xs">
            {t('components.memoryStores.labels.name')}
          </Label>
          <Input id="store-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="store-desc" className="text-xs">
            {t('components.memoryStores.labels.description')}
          </Label>
          <Textarea
            id="store-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </DocumentedDialog>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Path tree
// Memory paths are flat strings ('/user/profile.md', '/feedback/x.md'); the
// tree view is purely a UI synthesis on top — no real directories exist
// server-side. We build it at render time from the flat list, and persist
// per-store collapsed state so the user's expansion preference survives
// refresh. Selected-path ancestors are auto-expanded so a refresh that lands
// you on a deep selection always shows the leaf.

interface FileNode {
  kind: 'file'
  name: string
  path: string
  updatedAt: string
}

interface DirNode {
  kind: 'dir'
  name: string
  path: string // synthetic dir path, e.g. '/feedback'
  children: TreeNode[]
}

type TreeNode = FileNode | DirNode

function buildTree(items: { path: string; updatedAt: string }[]): TreeNode[] {
  const root: DirNode = { kind: 'dir', name: '', path: '', children: [] }
  for (const item of items) {
    const parts = item.path.split('/').filter(Boolean)
    if (parts.length === 0) continue
    const fileName = parts[parts.length - 1]
    const dirParts = parts.slice(0, -1)

    let cursor = root
    let acc = ''
    for (const seg of dirParts) {
      acc += `/${seg}`
      let dir = cursor.children.find((c): c is DirNode => c.kind === 'dir' && c.name === seg)
      if (!dir) {
        dir = { kind: 'dir', name: seg, path: acc, children: [] }
        cursor.children.push(dir)
      }
      cursor = dir
    }
    cursor.children.push({
      kind: 'file',
      name: fileName,
      path: item.path,
      updatedAt: item.updatedAt,
    })
  }
  sortTree(root)
  return root.children
}

function sortTree(dir: DirNode) {
  // Dirs first, then files; alphabetical within each group. The root-level
  // index file pins to the very top of the files group so it's the first
  // thing the user (and the eye) lands on.
  dir.children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
    if (a.kind === 'file' && b.kind === 'file') {
      if (isIndexPath(a.path)) return -1
      if (isIndexPath(b.path)) return 1
    }
    return a.name.localeCompare(b.name)
  })
  for (const c of dir.children) {
    if (c.kind === 'dir') sortTree(c)
  }
}

interface TreeViewProps {
  nodes: TreeNode[]
  depth: number
  selectedPath: string | null
  collapsedDirs: Record<string, boolean>
  forceExpanded: Set<string>
  locale: string
  onToggle: (dirPath: string) => void
  onSelect: (path: string) => void
}

function TreeView({
  nodes,
  depth,
  selectedPath,
  collapsedDirs,
  forceExpanded,
  locale,
  onToggle,
  onSelect,
}: TreeViewProps) {
  return (
    <ul className="py-1">
      {nodes.map((n) =>
        n.kind === 'dir' ? (
          <DirRow
            key={`d:${n.path}`}
            node={n}
            depth={depth}
            selectedPath={selectedPath}
            collapsedDirs={collapsedDirs}
            forceExpanded={forceExpanded}
            locale={locale}
            onToggle={onToggle}
            onSelect={onSelect}
          />
        ) : (
          <FileRow
            key={`f:${n.path}`}
            node={n}
            depth={depth}
            selected={selectedPath === n.path}
            locale={locale}
            onSelect={onSelect}
          />
        ),
      )}
    </ul>
  )
}

function DirRow({
  node,
  depth,
  selectedPath,
  collapsedDirs,
  forceExpanded,
  locale,
  onToggle,
  onSelect,
}: { node: DirNode } & Omit<TreeViewProps, 'nodes'>) {
  const isCollapsed = collapsedDirs[node.path] && !forceExpanded.has(node.path)
  const Chevron = isCollapsed ? ChevronRight : ChevronDown
  return (
    <li>
      <button
        type="button"
        onClick={() => onToggle(node.path)}
        className="flex w-full items-center gap-1 px-3 py-1 text-left text-xs transition hover:bg-accent"
        style={{ paddingLeft: 12 + depth * 14 }}
      >
        <Chevron className="h-3 w-3 shrink-0 text-muted-foreground/60" />
        <Folder className="h-3 w-3 shrink-0 text-muted-foreground/70" />
        <span className="truncate">{node.name}</span>
      </button>
      {!isCollapsed && (
        <TreeView
          nodes={node.children}
          depth={depth + 1}
          selectedPath={selectedPath}
          collapsedDirs={collapsedDirs}
          forceExpanded={forceExpanded}
          locale={locale}
          onToggle={onToggle}
          onSelect={onSelect}
        />
      )}
    </li>
  )
}

function FileRow({
  node,
  depth,
  selected,
  locale,
  onSelect,
}: {
  node: FileNode
  depth: number
  selected: boolean
  locale: string
  onSelect: (path: string) => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(node.path)}
        className={`flex w-full items-center gap-1.5 px-3 py-1 text-left text-xs transition hover:bg-accent ${
          selected ? 'bg-accent' : ''
        }`}
        style={{ paddingLeft: 12 + depth * 14 + 16 }}
      >
        {isIndexPath(node.path) ? (
          <BookText className="h-3 w-3 shrink-0 text-info" />
        ) : (
          <FileText className="h-3 w-3 shrink-0 text-muted-foreground/70" />
        )}
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
        <span className="shrink-0 text-tiny text-muted-foreground/60">
          {formatRelativeTime(node.updatedAt, locale)}
        </span>
      </button>
    </li>
  )
}

// `MEMORY.md` lives at the root of every store as an agent-maintained index
// (one line per memory file). It's not a memory: no frontmatter, no schema
// check, and the editor exposes it as a plain body so humans don't have to
// translate it to the structured form.
const INDEX_PATH = '/MEMORY.md'
function isIndexPath(p: string): boolean {
  return p === INDEX_PATH
}

// ── Frontmatter ─────────────────────────────────────────────────────────────
//
// We don't pull in a YAML library for two structured fields. Parser is
// intentionally narrow: it recognises the canonical shape from the
// __platform__ skill's reference/memory.md and ignores anything else, so
// hand-edited or agent-written content that deviates simply renders as
// raw markdown without metadata.

const MEMORY_TYPES = ['user', 'feedback', 'project', 'reference'] as const
export type MemoryType = (typeof MEMORY_TYPES)[number]

interface MemoryFrontmatter {
  name: string
  description: string
  type: MemoryType | null
  created: string
}

interface ParsedMemory {
  meta: MemoryFrontmatter | null
  body: string
}

function parseFrontmatter(content: string): ParsedMemory {
  if (!content.startsWith('---\n')) return { meta: null, body: content }
  const end = content.indexOf('\n---\n', 4)
  if (end < 0) return { meta: null, body: content }
  const yaml = content.slice(4, end)
  const body = content.slice(end + 5)
  const meta: MemoryFrontmatter = { name: '', description: '', type: null, created: '' }
  let inMetadata = false
  for (const rawLine of yaml.split('\n')) {
    if (!rawLine.trim()) continue
    const indented = rawLine.startsWith('  ') || rawLine.startsWith('\t')
    if (!indented) {
      inMetadata = false
      const m = rawLine.match(/^(\w+):\s*(.*)$/)
      if (!m) continue
      const [, key, value] = m
      if (key === 'name') meta.name = value.trim()
      else if (key === 'description') meta.description = value.trim()
      else if (key === 'metadata') inMetadata = true
    } else if (inMetadata) {
      const m = rawLine.match(/^\s+(\w+):\s*(.*)$/)
      if (!m) continue
      const [, key, value] = m
      const v = value.trim()
      if (key === 'type' && (MEMORY_TYPES as readonly string[]).includes(v))
        meta.type = v as MemoryType
      else if (key === 'created') meta.created = v
    }
  }
  return { meta, body }
}

function slugFromPath(path: string): string {
  const base = path.split('/').filter(Boolean).pop() ?? ''
  return base.replace(/\.md$/i, '')
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface StoreStatsStripProps {
  memoryCount: number
  attachmentCount: number
  updatedAt: string
  locale: string
}

function StoreStatsStrip({
  memoryCount,
  attachmentCount,
  updatedAt,
  locale,
}: StoreStatsStripProps) {
  const { t } = useTranslation()
  const items = [
    t('components.memoryStores.stats.memories', { count: memoryCount }),
    t('components.memoryStores.stats.attachments', { count: attachmentCount }),
    t('components.memoryStores.stats.updated', { when: formatRelativeTime(updatedAt, locale) }),
  ]
  return <p className="mt-0.5 truncate text-tiny text-muted-foreground/70">{items.join(' · ')}</p>
}
