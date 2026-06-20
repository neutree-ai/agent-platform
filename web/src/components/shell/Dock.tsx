import { LayoutSwitcher } from '@/components/shell/LayoutSwitcher'
import { SlotPicker } from '@/components/shell/SlotPicker'
import { FLEET_DEFAULT_LAYOUT, FLEET_LAYOUT_IDS } from '@/components/shell/layout/layouts'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useSlotContext } from '@/contexts/SlotContext'
import type { AppInstance } from '@/lib/app-registry'
import { cn } from '@/lib/utils'
import { FLEET_PROFILE_ID } from '@/stores/fleet-profile'
import {
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  type DropAnimation,
  KeyboardSensor,
  PointerSensor,
  defaultDropAnimationSideEffects,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { MoreHorizontal } from 'lucide-react'
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import type { Scope } from './Desktop'

// Dock grows with content within [MIN_DOCK_WIDTH, viewport - margins].
// Capacity is computed against the viewport-derived budget, so the dock
// only folds when even the available viewport width can't fit everything.
const MIN_DOCK_WIDTH = 360
const DOCK_HORIZONTAL_MARGIN = 96 // breathing room on each side at any viewport
const FOOTER_HORIZONTAL_PADDING = 32 // px-4 each side on the outer footer

// Coarse chrome estimates for non-pill space the dock reserves. The
// measurement layer feeds real per-pill widths, so only chrome is estimated.
const NON_SLOT_CHROME = 60 // shell padding + LayoutSwitcher + its trailing divider/gap
const SLOT_BASE_CHROME = 50 // slot picker + intra-slot gaps + inter-slot divider/gap
const OVERFLOW_CHEVRON = 30
const FALLBACK_PILL_WIDTH = 80
const MIN_CAPACITY = 1

// Drop animation: the overlay glides to the destination pill's position
// using the same expo-out curve as the push-aside animation, so entry and
// exit motion feel like one continuous gesture.
const dropAnimation: DropAnimation = {
  duration: 240,
  easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
  sideEffects: defaultDropAnimationSideEffects({
    styles: { active: { opacity: '0' } },
  }),
}

interface SlotApps {
  /** Open instances; widths is keyed by appId since pill label is per appId. */
  instances: AppInstance[]
}

function distributeCapacity(
  slots: SlotApps[],
  width: number,
  widths: Record<string, number>,
): number[] {
  const n = slots.length
  if (n === 0) return []
  // Start by trying to show everything. Trim from the slot whose currently-
  // shown widest pill is widest, until total fits.
  const caps = slots.map((s) => s.instances.length || MIN_CAPACITY)

  const pillWidth = (appId: string) => widths[appId] ?? FALLBACK_PILL_WIDTH

  function totalWidth(): number {
    let total = NON_SLOT_CHROME + SLOT_BASE_CHROME * n
    for (let i = 0; i < n; i++) {
      const xs = slots[i].instances.slice(0, caps[i])
      for (const x of xs) total += pillWidth(x.appId)
      if (caps[i] < slots[i].instances.length) total += OVERFLOW_CHEVRON
    }
    return total
  }

  let guard = 200
  while (totalWidth() > width && guard-- > 0) {
    let trimIdx = -1
    let trimCap = MIN_CAPACITY
    let trimLastWidth = 0
    for (let i = 0; i < n; i++) {
      if (caps[i] <= MIN_CAPACITY) continue
      const lastInst = slots[i].instances[caps[i] - 1]
      const w = pillWidth(lastInst.appId)
      if (caps[i] > trimCap || (caps[i] === trimCap && w > trimLastWidth)) {
        trimCap = caps[i]
        trimLastWidth = w
        trimIdx = i
      }
    }
    if (trimIdx < 0) break
    caps[trimIdx]--
  }
  return caps
}

function useDockBudget(footerRef: React.RefObject<HTMLElement>): number {
  const [budget, setBudget] = useState(0)
  useEffect(() => {
    if (!footerRef.current) return
    const node = footerRef.current
    const compute = (w: number) =>
      setBudget(Math.max(MIN_DOCK_WIDTH, w - FOOTER_HORIZONTAL_PADDING - DOCK_HORIZONTAL_MARGIN))
    compute(node.getBoundingClientRect().width)
    const ro = new ResizeObserver(([entry]) => compute(entry.contentRect.width))
    ro.observe(node)
    return () => ro.disconnect()
  }, [footerRef])
  return budget
}

function useDockCapacities(
  budget: number,
  slots: SlotApps[],
  widths: Record<string, number>,
): number[] {
  const slotsKey = slots.map((s) => s.instances.map((i) => i.id).join('|')).join(';')
  const widthsKey = Object.entries(widths)
    .map(([k, v]) => `${k}:${Math.round(v)}`)
    .sort()
    .join(',')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => distributeCapacity(slots, budget, widths), [budget, slotsKey, widthsKey])
}

interface DockProps {
  scope: Scope
  workspaceId?: string
}

export function Dock({ scope, workspaceId }: DockProps) {
  if (scope === 'ws' && workspaceId) {
    return <SegmentedDock scope="ws" />
  }
  return <SegmentedDock scope="fleet" />
}

/* ═══════════════════════ Slot-segmented dock ═══════════════════════ */

function SegmentedDock({ scope }: { scope: Scope }) {
  const ctx = useSlotContext()
  const { workspaceId } = useParams<{ workspaceId?: string }>()
  const footerRef = useRef<HTMLElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const budget = useDockBudget(footerRef)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  // Cross-slot drop target. We render a dashed placeholder pill at this
  // (slot, index) during drag so the user sees where the dragged pill will
  // land. Same-slot moves don't need this — SortableContext push-aside
  // already shows the gap. Cleared on drop / cancel.
  const [previewDest, setPreviewDest] = useState<{ slotId: string; index: number } | null>(null)
  // Holds the dock in expanded layout during drop animation so the dest
  // pill remains in the DOM and the overlay can animate to its real
  // landing position even when the destination would normally overflow.
  const [settling, setSettling] = useState(false)

  const sensors = useSensors(
    // Small activation distance lets pill clicks (activate) coexist with
    // drag — short pointer moves still register as taps.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const slotData: SlotApps[] = useMemo(
    () => ctx?.slots.map((s) => ({ instances: ctx.getState(s.id).opened })) ?? [],
    [ctx],
  )

  // Unique app types across all slots, used to render the offscreen
  // measurement layer. Two instances of the same app share a pill width since
  // they share a label.
  const uniqueAppIds = useMemo(() => {
    const seen = new Set<string>()
    const result: { id: string; label: string }[] = []
    for (const s of slotData) {
      for (const inst of s.instances) {
        if (seen.has(inst.appId)) continue
        seen.add(inst.appId)
        const app = ctx?.getApp(inst.appId)
        if (app) result.push({ id: inst.appId, label: app.label })
      }
    }
    return result
  }, [slotData, ctx])

  const [widths, setWidths] = useState<Record<string, number>>({})
  const idsKey = uniqueAppIds.map((a) => a.id).join(',')

  useLayoutEffect(() => {
    if (!measureRef.current) return
    const next: Record<string, number> = {}
    for (const el of measureRef.current.querySelectorAll<HTMLElement>('[data-app-id]')) {
      const id = el.dataset.appId
      if (id) next[id] = el.getBoundingClientRect().width
    }
    setWidths(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey])

  const caps = useDockCapacities(budget, slotData, widths)

  // Resolve which slot currently holds an instance — used to map the
  // dragged item back to its source slot when the pointer moves over a
  // different segment's items.
  const findSlotByInstance = (instanceId: string): string | null => {
    if (!ctx) return null
    for (const s of ctx.slots) {
      if (ctx.getState(s.id).opened.some((i) => i.id === instanceId)) return s.id
    }
    return null
  }

  const handleDragStart = (e: DragStartEvent) => {
    setDraggingId(String(e.active.id))
  }

  const handleDragOver = (e: DragOverEvent) => {
    if (!ctx) return
    const { active, over } = e
    if (!over) {
      setPreviewDest(null)
      return
    }
    const instanceId = String(active.id)
    const srcSlot = findSlotByInstance(instanceId)
    if (!srcSlot) return

    const overId = String(over.id)
    let destSlot: string | null = null
    let destIndex = -1
    if (overId.startsWith('slot:')) {
      destSlot = overId.slice(5)
      destIndex = ctx.getState(destSlot).opened.length
    } else {
      destSlot = findSlotByInstance(overId)
      if (destSlot) {
        destIndex = ctx.getState(destSlot).opened.findIndex((i) => i.id === overId)
      }
    }

    // Same-slot reordering already gets push-aside via SortableContext, so
    // skip the preview placeholder there to avoid double feedback.
    if (!destSlot || destSlot === srcSlot || destIndex < 0) {
      setPreviewDest(null)
      return
    }
    setPreviewDest((prev) =>
      prev && prev.slotId === destSlot && prev.index === destIndex
        ? prev
        : { slotId: destSlot, index: destIndex },
    )
  }

  const handleDragEnd = (e: DragEndEvent) => {
    setDraggingId(null)
    setPreviewDest(null)
    // Keep capacity expanded for the duration of the drop animation, so the
    // pill the overlay animates toward is still mounted at its dest position.
    setSettling(true)
    window.setTimeout(() => setSettling(false), 260)
    if (!ctx) return
    const { active, over } = e
    if (!over) return
    const instanceId = String(active.id)
    const srcSlot = findSlotByInstance(instanceId)
    if (!srcSlot) return

    // `over.id` is either another pill's instance id or a droppable
    // container id (`slot:<id>`). Resolve dest slot + index from it.
    const overId = String(over.id)
    let destSlot: string | null = null
    let destIndex = -1

    if (overId.startsWith('slot:')) {
      destSlot = overId.slice(5)
      destIndex = ctx.getState(destSlot).opened.length
    } else {
      destSlot = findSlotByInstance(overId)
      if (destSlot) {
        destIndex = ctx.getState(destSlot).opened.findIndex((i) => i.id === overId)
      }
    }
    if (!destSlot || destIndex < 0) return
    if (srcSlot === destSlot) {
      const opened = ctx.getState(srcSlot).opened
      const fromIdx = opened.findIndex((i) => i.id === instanceId)
      if (fromIdx === destIndex) return
    }
    ctx.moveInstance(srcSlot, destSlot, instanceId, destIndex)
  }

  if (!ctx) return null

  const draggingInst = draggingId
    ? ctx.slots.map((s) => ctx.getState(s.id).opened.find((i) => i.id === draggingId)).find(Boolean)
    : null
  const draggingApp = draggingInst ? ctx.getApp(draggingInst.appId) : null

  return (
    <>
      {/* Offscreen measurement layer: renders every opened pill with the same
          styling so we can measure their true rendered widths. */}
      <div
        ref={measureRef}
        aria-hidden
        className="pointer-events-none invisible fixed left-0 top-0 -z-10 flex items-center gap-0.5"
      >
        {uniqueAppIds.map(({ id, label }) => (
          <span key={id} data-app-id={id} className={dockItemClass(false)}>
            {label}
          </span>
        ))}
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          setDraggingId(null)
          setPreviewDest(null)
        }}
      >
        <DockShell footerRef={footerRef} maxWidth={budget}>
          {scope === 'ws' && workspaceId ? (
            <>
              <LayoutSwitcher profileId={workspaceId} workspaceId={workspaceId} />
              <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-foreground/[0.10]" />
            </>
          ) : (
            <>
              <LayoutSwitcher
                profileId={FLEET_PROFILE_ID}
                allowed={FLEET_LAYOUT_IDS}
                defaultId={FLEET_DEFAULT_LAYOUT}
              />
              <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-foreground/[0.10]" />
            </>
          )}
          {ctx.slots.map((slot, i) => (
            <DockSegment
              key={slot.id}
              slotId={slot.id}
              showDivider={i > 0}
              capacity={caps[i] ?? MIN_CAPACITY}
              draggingId={draggingId}
              expanded={draggingId !== null || settling}
              previewIndex={previewDest?.slotId === slot.id ? previewDest.index : null}
              previewLabel={draggingApp?.label ?? null}
            />
          ))}
        </DockShell>
        <DragOverlay dropAnimation={dropAnimation}>
          {draggingApp ? (
            <span
              className={cn(dockItemClass(false), 'cursor-grabbing bg-foreground/[0.08] shadow-lg')}
            >
              {draggingApp.label}
            </span>
          ) : null}
        </DragOverlay>
      </DndContext>
    </>
  )
}

interface DockSegmentProps {
  slotId: string
  showDivider: boolean
  capacity: number
  draggingId: string | null
  /** Hold the expanded layout while dragging or settling after drop. */
  expanded: boolean
  /** Insertion index for the cross-slot drop preview, or null if N/A. */
  previewIndex: number | null
  /** Label of the dragged pill — used to size the preview placeholder. */
  previewLabel: string | null
}

function DockSegment({
  slotId,
  showDivider,
  capacity,
  draggingId,
  expanded,
  previewIndex,
  previewLabel,
}: DockSegmentProps) {
  const ctx = useSlotContext()
  // Make the segment a droppable container so empty slots and the trailing
  // gap before the picker can accept drops.
  const { setNodeRef, isOver } = useDroppable({ id: `slot:${slotId}` })
  if (!ctx) return null
  const state = ctx.getState(slotId)

  // While dragging (or settling after drop), expand to show all pills so
  // every instance is reachable as a drop target / animation target.
  const isDragging = draggingId !== null
  const effectiveCapacity = expanded ? state.opened.length : capacity

  let visible = state.opened.slice(0, effectiveCapacity)
  if (state.activeId && !visible.some((i) => i.id === state.activeId)) {
    const active = state.opened.find((i) => i.id === state.activeId)
    if (active) visible = [...visible.slice(0, effectiveCapacity - 1), active]
  }
  const visibleIds = new Set(visible.map((i) => i.id))
  const overflow = state.opened.filter((i) => !visibleIds.has(i.id))

  return (
    <>
      {showDivider && <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-foreground/[0.10]" />}
      <div
        ref={setNodeRef}
        className={cn(
          'flex shrink-0 items-center gap-0.5 rounded-full transition-colors',
          isOver && isDragging && 'bg-foreground/[0.04]',
        )}
      >
        <SortableContext items={visible.map((i) => i.id)} strategy={horizontalListSortingStrategy}>
          {visible.map((inst, idx) => {
            const app = ctx.getApp(inst.appId)
            if (!app) return null
            const insertHere = previewIndex === idx && previewLabel !== null
            return (
              <Fragment key={inst.id}>
                {insertHere && <PreviewPill label={previewLabel as string} />}
                <SortablePill
                  instanceId={inst.id}
                  slotId={slotId}
                  label={app.label}
                  active={state.activeId === inst.id}
                  disabled={!!app.disabled}
                  ghost={draggingId === inst.id}
                  onActivate={() => ctx.activate(slotId, inst.id)}
                />
              </Fragment>
            )
          })}
          {previewIndex !== null && previewLabel !== null && previewIndex >= visible.length && (
            <PreviewPill label={previewLabel} />
          )}
        </SortableContext>
        {!isDragging && overflow.length > 0 && (
          <SegmentOverflow slotId={slotId} instances={overflow} />
        )}
        <SlotPicker slotId={slotId} align="start" />
      </div>
    </>
  )
}

function SortablePill({
  instanceId,
  slotId,
  label,
  active,
  disabled,
  ghost,
  onActivate,
}: {
  instanceId: string
  slotId: string
  label: string
  active: boolean
  disabled: boolean
  ghost: boolean
  onActivate: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: instanceId,
    data: { slotId },
    disabled,
    // Smoother spring-like easing for the push-aside motion.
    transition: {
      duration: 220,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    },
  })
  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  }
  const isPlaceholder = ghost || isDragging
  return (
    <button
      ref={setNodeRef}
      type="button"
      style={style}
      onClick={onActivate}
      aria-current={active ? 'page' : undefined}
      disabled={disabled}
      {...attributes}
      {...listeners}
      className={cn(
        'relative shrink-0 rounded-full px-3.5 py-1 text-sm tracking-tight',
        // Always reserve a 1px border slot so toggling into placeholder mode
        // doesn't widen the pill (auto-width + border-box still grows by 2px
        // when a border appears, which would shift adjacent pills).
        'border border-transparent',
        'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25',
        'touch-none',
        disabled && 'cursor-not-allowed opacity-40',
        isPlaceholder
          ? // Placeholder: empty hollow slot showing where the dragged pill
            // came from / will return to. Width preserved via invisible label.
            cn(
              'border-dashed border-foreground/20 bg-foreground/[0.02]',
              'text-transparent select-none',
            )
          : cn(
              'transition-[transform,color] duration-200',
              'hover:-translate-y-px',
              active
                ? cn(
                    'font-medium text-foreground',
                    'after:pointer-events-none after:absolute after:bottom-0.5 after:left-1/2 after:h-[2px] after:w-3',
                    'after:-translate-x-1/2 after:rounded-full after:bg-primary/70',
                  )
                : 'font-normal text-muted-foreground/80 hover:text-foreground',
            ),
      )}
    >
      {label}
    </button>
  )
}

/**
 * Cross-slot drop preview. A non-interactive dashed pill showing where the
 * dragged instance will land in the destination slot. Uses an invisible copy
 * of the dragged pill's label so its width matches the real pill, keeping
 * the layout stable when the dashed slot becomes a real pill on drop.
 */
function PreviewPill({ label }: { label: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'shrink-0 rounded-full border border-dashed px-3.5 py-1 text-sm tracking-tight',
        'border-primary/45 bg-primary/[0.06]',
        'select-none text-transparent',
        'animate-in fade-in zoom-in-95 duration-150',
      )}
    >
      {label}
    </span>
  )
}

function SegmentOverflow({
  slotId,
  instances,
}: {
  slotId: string
  instances: AppInstance[]
}) {
  const { t } = useTranslation()
  const ctx = useSlotContext()
  const [open, setOpen] = useState(false)
  if (!ctx) return null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t('components.shell.slot.overflowLabel', { count: instances.length })}
          title={t('components.shell.slot.overflowLabel', { count: instances.length })}
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
            'transition-colors duration-150',
            'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25',
            open
              ? 'bg-foreground/[0.10] text-foreground'
              : 'text-muted-foreground/70 hover:text-foreground',
          )}
        >
          <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="center"
        sideOffset={8}
        className="w-48 rounded-xl border-foreground/[0.08] p-1 shadow-lg"
      >
        <ul className="flex flex-col gap-0.5">
          {instances.map((inst) => {
            const app = ctx.getApp(inst.appId)
            if (!app) return null
            return (
              <li key={inst.id}>
                <button
                  type="button"
                  onClick={() => {
                    ctx.activate(slotId, inst.id)
                    setOpen(false)
                  }}
                  className={cn(
                    'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm',
                    'transition-colors duration-150',
                    'hover:bg-foreground/[0.06]',
                    app.disabled && 'opacity-50',
                  )}
                >
                  <span>{app.label}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

/* ═══════════════════════ Shared chrome ═══════════════════════ */

function DockShell({
  children,
  footerRef,
  maxWidth,
}: {
  children: React.ReactNode
  footerRef?: React.Ref<HTMLElement>
  maxWidth?: number
}) {
  const { t } = useTranslation()
  return (
    <footer ref={footerRef} className="flex shrink-0 justify-center px-4 pb-3 pt-1">
      <nav
        aria-label={t('components.shell.dock.label')}
        style={{ minWidth: MIN_DOCK_WIDTH, maxWidth: maxWidth || undefined }}
        className={cn(
          'group relative flex items-center justify-center',
          'overflow-hidden rounded-full border border-foreground/[0.08]',
          // Prismatic ambient gradient — primary on the left fades into info on the right,
          // both at low alpha so the wallpaper still reads through the backdrop blur.
          'bg-gradient-to-r from-primary/[0.10] via-foreground/[0.04] to-info/[0.10]',
          'backdrop-blur-2xl backdrop-saturate-150',
          'shadow-2xl ring-1 ring-inset ring-foreground/[0.04]',
        )}
      >
        {/* Sheen — angled bright stripe, like a slant of sunlight. Fades in on hover. */}
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute -top-1/2 -bottom-1/2 -left-[5%] w-[40%] rotate-[14deg]',
            'bg-gradient-to-r from-transparent via-white/15 to-transparent',
            'opacity-0 transition-opacity duration-700 ease-out group-hover:opacity-100',
          )}
        />
        <div className="relative z-10 flex w-full items-center justify-center gap-1 overflow-x-auto scrollbar-none px-1.5 py-1">
          {children}
        </div>
      </nav>
    </footer>
  )
}

function dockItemClass(active: boolean): string {
  return cn(
    'relative shrink-0 rounded-full px-3.5 py-1 text-sm tracking-tight',
    // Match SortablePill's reserved border slot so offscreen width
    // measurements line up with rendered widths during drag.
    'border border-transparent',
    'transition-[transform,color] duration-200',
    'hover:-translate-y-px',
    'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25',
    active
      ? cn(
          'font-medium text-foreground',
          // Active indicator: lit pill below the label, replacing the heavier bg fill.
          'after:pointer-events-none after:absolute after:bottom-0.5 after:left-1/2 after:h-[2px] after:w-3',
          'after:-translate-x-1/2 after:rounded-full after:bg-primary/70',
        )
      : 'font-normal text-muted-foreground/80 hover:text-foreground',
  )
}
