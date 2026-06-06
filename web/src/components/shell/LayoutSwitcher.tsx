import { LAYOUTS, LAYOUT_IDS, type LayoutId } from '@/components/shell/layout/layouts'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useActiveLayout } from '@/hooks/useActiveLayout'
import { useLayoutState } from '@/hooks/useLayoutState'
import {
  useDeleteWorkspaceLayout,
  useUpdateWorkspaceLayout,
  useWorkspaceLayouts,
} from '@/hooks/useWorkspaceLayouts'
import type { ApiWorkspaceLayout } from '@/lib/api/types'
import { isCommitEnter } from '@/lib/keyboard'
import { cn } from '@/lib/utils'
import { Check, LayoutPanelLeft, Pencil, Plus, RotateCcw, Save, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface LayoutSwitcherProps {
  /** Profile id whose layout this switcher controls. */
  profileId: string | undefined
  /** Subset of layouts to expose. Defaults to all. */
  allowed?: readonly LayoutId[]
  /** Fallback layout when the stored value is unset / outside `allowed`. */
  defaultId?: LayoutId
  /**
   * When set (ws scope), the popover also offers saved layouts + same/edited
   * actions for this workspace. Omitted in fleet scope (column switch only).
   */
  workspaceId?: string
}

/**
 * Compact single-icon switcher: trigger shows the active layout's icon; the
 * popover lists column frames and — in ws scope — the user's saved layouts and
 * the same/edited actions (Apply / Reset / Save as / Update).
 */
export function LayoutSwitcher({
  profileId,
  allowed,
  defaultId,
  workspaceId,
}: LayoutSwitcherProps) {
  const { t } = useTranslation()
  const { layoutId, setLayoutId } = useActiveLayout(profileId, { allowed, defaultId })
  const visibleIds = allowed ?? LAYOUT_IDS
  const [open, setOpen] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)
  const [editing, setEditing] = useState<ApiWorkspaceLayout | null>(null)
  const [deleting, setDeleting] = useState<ApiWorkspaceLayout | null>(null)
  const triggerLabel = t('components.shell.layout.switcher')

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={triggerLabel}
            title={triggerLabel}
            className={cn(
              'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
              'text-muted-foreground/70 transition-colors duration-150 hover:text-foreground',
              'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25',
              open && 'bg-foreground/[0.10] text-foreground',
            )}
          >
            <LayoutPanelLeft className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          sideOffset={8}
          className={cn(
            'rounded-xl border-foreground/[0.08] p-1 shadow-lg',
            workspaceId ? 'w-60' : 'w-44',
          )}
        >
          {workspaceId ? (
            <WorkspaceLayoutMenu
              workspaceId={workspaceId}
              visibleIds={visibleIds}
              layoutId={layoutId}
              onApplied={() => setOpen(false)}
              onRequestSave={() => {
                setOpen(false)
                setSaveOpen(true)
              }}
              onRequestEdit={(l) => {
                setOpen(false)
                setEditing(l)
              }}
              onRequestDelete={(l) => {
                setOpen(false)
                setDeleting(l)
              }}
            />
          ) : (
            <FrameList
              visibleIds={visibleIds}
              layoutId={layoutId}
              onPick={(id) => {
                setLayoutId(id)
                setOpen(false)
              }}
            />
          )}
        </PopoverContent>
      </Popover>

      {workspaceId && (
        <SaveLayoutDialog workspaceId={workspaceId} open={saveOpen} onOpenChange={setSaveOpen} />
      )}
      <EditLayoutDialog layout={editing} onClose={() => setEditing(null)} />
      <DeleteLayoutDialog layout={deleting} onClose={() => setDeleting(null)} />
    </>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 pb-1 pt-1.5 text-mini font-medium uppercase tracking-wide text-muted-foreground/70">
      {children}
    </div>
  )
}

/**
 * Column frame rows (1/2/3-col). The active frame carries the edited dot only
 * when `presetEdited` — i.e., the built-in default is the active preset and the
 * live layout has diverged. When a saved layout is selected, the dot lives on
 * that layout's row instead.
 */
function FrameList({
  visibleIds,
  layoutId,
  onPick,
  presetEdited,
  highlightActive = true,
}: {
  visibleIds: readonly LayoutId[]
  layoutId: LayoutId
  onPick: (id: LayoutId) => void
  presetEdited?: boolean
  /**
   * Whether the current frame is shown as active. The frames represent the
   * built-in default presets, so they only highlight when that default is the
   * active preset (selectedId === null). With a saved layout selected, they're
   * dormant quick-switches and nothing is highlighted.
   */
  highlightActive?: boolean
}) {
  const { t } = useTranslation()
  return (
    <ul className="flex flex-col gap-0.5">
      {visibleIds.map((id) => {
        const def = LAYOUTS[id]
        const Icon = def.icon
        const active = highlightActive && id === layoutId
        return (
          <li key={id}>
            <button
              type="button"
              onClick={() => onPick(id)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',
                'transition-colors duration-150',
                active
                  ? 'bg-foreground/[0.06] text-foreground'
                  : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground',
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              <span className="min-w-0 flex-1 truncate">{t(def.labelKey)}</span>
              {active && presetEdited && (
                <span
                  title={t('components.shell.layout.editedHint')}
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning"
                />
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function WorkspaceLayoutMenu({
  workspaceId,
  visibleIds,
  layoutId,
  onApplied,
  onRequestSave,
  onRequestEdit,
  onRequestDelete,
}: {
  workspaceId: string
  visibleIds: readonly LayoutId[]
  layoutId: LayoutId
  onApplied: () => void
  onRequestSave: () => void
  onRequestEdit: (layout: ApiWorkspaceLayout) => void
  onRequestDelete: (layout: ApiWorkspaceLayout) => void
}) {
  const { t } = useTranslation()
  const { layouts } = useWorkspaceLayouts()
  const { selectedId, kind, state, apply, applyBuiltinFrame, reset, updateSelected } =
    useLayoutState(workspaceId)

  const hasSaved = layouts.length > 0
  // On the built-in default the active frame above is the preset; mark it edited
  // there. A selected saved layout carries the dot on its own row instead.
  const presetEdited = selectedId === null && state === 'edited'

  return (
    <>
      <FrameList
        visibleIds={visibleIds}
        layoutId={layoutId}
        presetEdited={presetEdited}
        // Frames highlight only while the built-in default is the active preset.
        highlightActive={selectedId === null}
        // A frame IS the built-in default preset at that column count — picking
        // one selects it (and returns here from any custom layout).
        onPick={(id) => {
          applyBuiltinFrame(id)
          onApplied()
        }}
      />

      {hasSaved && (
        <>
          <div className="my-1 h-px bg-foreground/[0.06]" />
          <SectionLabel>{t('components.shell.layout.savedLayouts')}</SectionLabel>
          <ul className="flex max-h-48 flex-col gap-0.5 overflow-y-auto">
            {layouts.map((l) => (
              <li key={l.id}>
                <LayoutRow
                  label={l.name}
                  badge={
                    l.origin === 'template' ? t('components.shell.layout.templateBadge') : undefined
                  }
                  active={selectedId === l.id}
                  edited={state === 'edited'}
                  onClick={() => {
                    apply(l)
                    onApplied()
                  }}
                  // Template-origin copies are sync-managed: no edit/delete.
                  onEdit={l.origin === 'local' ? () => onRequestEdit(l) : undefined}
                  onDelete={l.origin === 'local' ? () => onRequestDelete(l) : undefined}
                />
              </li>
            ))}
          </ul>
        </>
      )}

      {state === 'edited' && (
        <>
          <div className="my-1 h-px bg-foreground/[0.06]" />
          <div className="flex flex-wrap gap-1 px-1 pb-0.5">
            {kind === 'custom' && (
              <ActionButton
                icon={Save}
                label={t('components.shell.layout.update')}
                onClick={updateSelected}
              />
            )}
            <ActionButton
              icon={Plus}
              label={t('components.shell.layout.saveAs')}
              onClick={onRequestSave}
            />
            <ActionButton
              icon={RotateCcw}
              label={t('components.shell.layout.reset')}
              onClick={() => {
                reset()
                onApplied()
              }}
            />
          </div>
        </>
      )}
    </>
  )
}

function LayoutRow({
  label,
  badge,
  active,
  edited,
  onClick,
  onEdit,
  onDelete,
}: {
  label: string
  badge?: string
  active: boolean
  /** Only meaningful on the active row: the live arrangement diverged. */
  edited?: boolean
  onClick: () => void
  /** Hover-revealed edit/delete (local-origin layouts only). */
  onEdit?: () => void
  onDelete?: () => void
}) {
  const { t } = useTranslation()
  const hasActions = !!(onEdit || onDelete)
  return (
    <div
      className={cn(
        'group/row flex items-center rounded-md text-sm transition-colors duration-150',
        active
          ? 'bg-foreground/[0.06] text-foreground'
          : 'text-muted-foreground hover:bg-foreground/[0.04]',
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left hover:text-foreground"
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {badge && (
          <span className="shrink-0 rounded bg-foreground/[0.06] px-1 text-mini text-muted-foreground">
            {badge}
          </span>
        )}
      </button>
      <div className="flex shrink-0 items-center gap-0.5 pr-1.5">
        {/* Active indicator; hidden on hover when actions are available. */}
        {active && (
          <span className={cn('flex items-center', hasActions && 'group-hover/row:hidden')}>
            {edited ? (
              <span
                title={t('components.shell.layout.editedHint')}
                className="h-1.5 w-1.5 rounded-full bg-warning"
              />
            ) : (
              <Check className="h-3.5 w-3.5 text-primary" strokeWidth={2.5} />
            )}
          </span>
        )}
        {hasActions && (
          <span className="hidden items-center gap-0.5 group-hover/row:flex">
            {onEdit && (
              <button
                type="button"
                title={t('components.shell.layout.edit')}
                onClick={onEdit}
                className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground"
              >
                <Pencil className="h-3 w-3" />
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                title={t('common.delete')}
                onClick={onDelete}
                className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-foreground/[0.08] hover:text-destructive"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </span>
        )}
      </div>
    </div>
  )
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Save
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1 rounded-md px-2 py-1 text-xs',
        'text-muted-foreground transition-colors duration-150',
        'hover:bg-foreground/[0.04] hover:text-foreground',
      )}
    >
      <Icon className="h-3 w-3 shrink-0" strokeWidth={2} />
      {label}
    </button>
  )
}

function SaveLayoutDialog({
  workspaceId,
  open,
  onOpenChange,
}: {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const { saveAsNew } = useLayoutState(workspaceId)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!name.trim()) return
    setSaving(true)
    try {
      await saveAsNew(name.trim())
      onOpenChange(false)
      setName('')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) setName('')
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('components.shell.layout.saveDialog.title')}</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          placeholder={t('components.shell.layout.saveDialog.namePlaceholder')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (isCommitEnter(e)) submit()
          }}
          className="text-sm"
        />
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" disabled={!name.trim() || saving} onClick={submit}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Edit a saved layout — name today, room to grow into deeper customization. */
function EditLayoutDialog({
  layout,
  onClose,
}: {
  layout: ApiWorkspaceLayout | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const update = useUpdateWorkspaceLayout()
  const [name, setName] = useState('')

  useEffect(() => {
    if (layout) setName(layout.name)
  }, [layout])

  async function submit() {
    if (!layout || !name.trim()) return
    await update.mutateAsync({ id: layout.id, data: { name: name.trim() } })
    onClose()
  }

  return (
    <Dialog open={layout !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('components.shell.layout.editTitle')}</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (isCommitEnter(e)) submit()
          }}
          className="text-sm"
        />
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" disabled={!name.trim() || update.isPending} onClick={submit}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeleteLayoutDialog({
  layout,
  onClose,
}: {
  layout: ApiWorkspaceLayout | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const del = useDeleteWorkspaceLayout()

  async function confirm() {
    if (!layout) return
    await del.mutateAsync(layout.id)
    onClose()
  }

  return (
    <Dialog open={layout !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('components.shell.layout.deleteTitle')}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          {t('components.shell.layout.deleteConfirm', { name: layout?.name ?? '' })}
        </p>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="destructive" size="sm" disabled={del.isPending} onClick={confirm}>
            {t('common.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
