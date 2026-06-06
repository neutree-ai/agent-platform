import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useRequiredSlotContext } from '@/contexts/SlotContext'
import type { AppDefinition, AppInstance } from '@/lib/app-registry'
import { cn } from '@/lib/utils'
import { useWorkspaceProfile } from '@/stores/workspace-profile-store'
import { ChevronRight, Plus } from 'lucide-react'
import { type ReactNode, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

type Group = NonNullable<AppDefinition['group']>

const GROUP_ORDER: Group[] = ['agent', 'tool', 'capability', 'connection', 'extension', 'system']

interface SlotPickerProps {
  slotId: string
  /**
   * Trigger element. When omitted, a default compact `+` button is used
   * (suited for the dock segment tail). Pass custom children to make any
   * region act as the picker trigger (e.g., empty-state surface).
   */
  children?: ReactNode
  /** Popover side alignment relative to trigger. */
  side?: 'top' | 'bottom' | 'left' | 'right'
  align?: 'start' | 'center' | 'end'
}

/**
 * Lists every visible app, grouped by `AppDefinition.group`. Each group is
 * a 3-column grid so dense pickers stay short. Search filters across labels
 * via cmdk's built-in matching. Disabled apps are dimmed but still clickable
 * (opening shows the app's own NotRunning state).
 *
 * Default click behavior is dock-like:
 *   0 instances in slot → open() a new one
 *   1 instance          → activate() that one
 *   ≥2 instances        → activate() the most recent; hover/focus reveals a
 *                          flyout submenu listing each instance and a
 *                          "+ New instance" action
 * Apps already present in the slot show a small dot indicator on the left;
 * hovering an active item reveals a trailing `+` button for forcing a new
 * instance.
 */
export function SlotPicker({ slotId, children, side = 'top', align = 'end' }: SlotPickerProps) {
  const { t } = useTranslation()
  const ctx = useRequiredSlotContext()
  const { apps, open, activate, getState, workspaceId } = ctx
  const [openPopover, setOpenPopover] = useState(false)
  const [expandedAppId, setExpandedAppId] = useState<string | null>(null)
  const [flyoutAnchor, setFlyoutAnchor] = useState<{ top: number; right: number } | null>(null)
  const closeFlyoutTimer = useRef<number | null>(null)

  // Subscribe to the full profile so instanceLabel re-renders when persistent
  // state for an open instance shifts (e.g. file viewingPath).
  const profile = useWorkspaceProfile(workspaceId)
  const instancesMap =
    (profile as { instances?: Record<string, Record<string, unknown>> }).instances ?? {}

  const state = getState(slotId)
  const instancesByAppId = useMemo(() => {
    const m = new Map<string, AppInstance[]>()
    for (const inst of state.opened) {
      const list = m.get(inst.appId) ?? []
      list.push(inst)
      m.set(inst.appId, list)
    }
    return m
  }, [state.opened])

  function closeAll() {
    setOpenPopover(false)
    setExpandedAppId(null)
  }

  function handleSelect(app: AppDefinition) {
    const insts = instancesByAppId.get(app.id) ?? []
    if (insts.length === 0) {
      open(slotId, app.id)
    } else {
      // Activate the most recently opened (= last in dock order).
      activate(slotId, insts[insts.length - 1].id)
    }
    closeAll()
  }

  function handleNew(appId: string) {
    open(slotId, appId)
    closeAll()
  }

  function handleActivateInstance(instanceId: string) {
    activate(slotId, instanceId)
    closeAll()
  }

  function scheduleFlyoutClose() {
    if (closeFlyoutTimer.current !== null) window.clearTimeout(closeFlyoutTimer.current)
    closeFlyoutTimer.current = window.setTimeout(() => {
      setExpandedAppId(null)
      closeFlyoutTimer.current = null
    }, 120)
  }

  function cancelFlyoutClose() {
    if (closeFlyoutTimer.current !== null) {
      window.clearTimeout(closeFlyoutTimer.current)
      closeFlyoutTimer.current = null
    }
  }

  function maybeExpand(app: AppDefinition, el: HTMLElement | null) {
    const insts = instancesByAppId.get(app.id) ?? []
    cancelFlyoutClose()
    if (insts.length >= 2 && el) {
      const r = el.getBoundingClientRect()
      setFlyoutAnchor({ top: r.top, right: r.left })
      setExpandedAppId(app.id)
    } else {
      setExpandedAppId(null)
      setFlyoutAnchor(null)
    }
  }

  // Bucket apps by group; hidden apps never appear here. Stable group order
  // lives in GROUP_ORDER so authors can register apps in any sequence.
  const grouped = useMemo(() => {
    const buckets = new Map<Group, AppDefinition[]>()
    for (const app of apps) {
      if (app.hidden) continue
      const g = app.group ?? 'tool'
      if (!buckets.has(g)) buckets.set(g, [])
      buckets.get(g)!.push(app)
    }
    return GROUP_ORDER.map((g) => ({ group: g, items: buckets.get(g) ?? [] })).filter(
      (s) => s.items.length > 0,
    )
  }, [apps])

  const expandedApp = expandedAppId ? apps.find((a) => a.id === expandedAppId) : null
  const expandedInstances = expandedAppId ? (instancesByAppId.get(expandedAppId) ?? []) : []

  return (
    <Popover
      open={openPopover}
      onOpenChange={(o) => {
        setOpenPopover(o)
        if (!o) setExpandedAppId(null)
      }}
    >
      <PopoverTrigger asChild>
        {children ?? (
          <button
            type="button"
            aria-label={t('components.shell.slot.openApp')}
            title={t('components.shell.slot.openApp')}
            className={cn(
              'shrink-0 rounded-full px-2 py-1',
              'text-muted-foreground/60 transition-colors duration-150 hover:text-foreground',
              'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25',
            )}
          >
            <Plus className="h-4 w-4" strokeWidth={2.25} />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        sideOffset={8}
        className="w-[640px] overflow-visible rounded-xl border-foreground/[0.08] p-0 shadow-lg"
      >
        <div className="relative">
          <Command className="rounded-xl">
            <CommandInput placeholder={t('components.shell.slot.searchPlaceholder')} />
            <CommandList className="max-h-[60vh]">
              <CommandEmpty>{t('components.shell.slot.noResults')}</CommandEmpty>
              {/* Groups laid out as columns (Mission Control style). cmdk
                  still walks items in DOM order for keyboard nav, which means
                  column-by-column top-to-bottom — natural for vertical lists.
                  Each column has its own internal scroll if it overflows. */}
              <div className="grid grid-cols-3 gap-2 p-2">
                {grouped.map(({ group, items }) => (
                  <CommandGroup
                    key={group}
                    heading={t(`components.shell.slot.groups.${group}`)}
                    className={cn(
                      'min-w-0',
                      // Apple-style section labels — smaller, faded, uppercase
                      // tracking so the category reads as chrome rather than as
                      // an item it lives above.
                      '[&_[cmdk-group-heading]]:px-1.5',
                      '[&_[cmdk-group-heading]]:pt-0.5 [&_[cmdk-group-heading]]:pb-1',
                      '[&_[cmdk-group-heading]]:text-[10px]',
                      '[&_[cmdk-group-heading]]:font-medium',
                      '[&_[cmdk-group-heading]]:uppercase',
                      '[&_[cmdk-group-heading]]:tracking-wider',
                      '[&_[cmdk-group-heading]]:text-muted-foreground/60',
                    )}
                  >
                    {items.map((app) => {
                      const insts = instancesByAppId.get(app.id) ?? []
                      const hasInstances = insts.length > 0
                      const hasMultiple = insts.length >= 2
                      return (
                        <CommandItem
                          key={app.id}
                          value={`${app.label} ${app.id}`}
                          onSelect={() => handleSelect(app)}
                          onMouseEnter={(e) => maybeExpand(app, e.currentTarget)}
                          onMouseLeave={scheduleFlyoutClose}
                          onFocus={(e) => maybeExpand(app, e.currentTarget)}
                          className={cn(
                            'group/item relative cursor-pointer rounded-md px-2 py-1.5 text-sm',
                            app.disabled && 'opacity-50',
                          )}
                        >
                          {/* Wrap label + dot so cmdk's `gap-2` between
                              CommandItem children doesn't blow the dot away
                              from the label. Inner gap is tight. */}
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate">{app.label}</span>
                            {hasInstances && (
                              <span
                                aria-hidden
                                className="h-1 w-1 shrink-0 rounded-full bg-primary/70"
                              />
                            )}
                          </span>
                          {app.badge && (
                            <span className="ml-2 shrink-0 rounded-sm bg-warning/15 px-1.5 py-px font-medium text-[10px] text-warning uppercase tracking-wider">
                              {app.badge}
                            </span>
                          )}
                          {/* Trailing `+` to force a new instance. Shown on
                              hover when at least one instance exists; for
                              multi-instance items the submenu also offers it,
                              but keeping it on the row makes "open another"
                              one click regardless of submenu state. */}
                          {hasInstances && !hasMultiple && (
                            <button
                              type="button"
                              aria-label={t('components.shell.slot.newInstance')}
                              title={t('components.shell.slot.newInstance')}
                              onClick={(e) => {
                                e.stopPropagation()
                                handleNew(app.id)
                              }}
                              onPointerDown={(e) => e.stopPropagation()}
                              className={cn(
                                'ml-auto inline-flex h-5 w-5 shrink-0 items-center justify-center rounded',
                                'opacity-0 transition-opacity duration-100 group-hover/item:opacity-100 focus-visible:opacity-100',
                                'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground',
                                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                              )}
                            >
                              <Plus className="h-3.5 w-3.5" strokeWidth={2.25} />
                            </button>
                          )}
                          {hasMultiple && (
                            <span
                              aria-hidden
                              className="ml-auto inline-flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground/60"
                            >
                              <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.25} />
                            </span>
                          )}
                        </CommandItem>
                      )
                    })}
                  </CommandGroup>
                ))}
              </div>
            </CommandList>
          </Command>

          {/* Flyout submenu for multi-instance items. Portaled to body so
              fixed-positioning isn't trapped by the Popover's transform
              context (Radix uses CSS transform for placement, which would
              otherwise re-anchor `position: fixed`). */}
          {expandedApp &&
            expandedInstances.length >= 2 &&
            flyoutAnchor &&
            createPortal(
              <div
                className="fixed z-[60] w-56 rounded-xl border border-foreground/[0.08] bg-popover p-1 shadow-lg"
                style={{
                  top: flyoutAnchor.top,
                  left: flyoutAnchor.right - 224 - 8,
                }}
                onMouseEnter={cancelFlyoutClose}
                onMouseLeave={scheduleFlyoutClose}
              >
                <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                  {expandedApp.label}
                </div>
                {expandedInstances.map((inst, idx) => {
                  const persistent = instancesMap[inst.id] ?? {}
                  const derived = expandedApp.instanceLabel?.(persistent) ?? null
                  const label = derived ?? `#${idx + 1}`
                  const isActive = state.activeId === inst.id
                  return (
                    <button
                      key={inst.id}
                      type="button"
                      onClick={() => handleActivateInstance(inst.id)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                        'hover:bg-foreground/[0.06]',
                        'focus-visible:outline-none focus-visible:bg-foreground/[0.06]',
                        isActive ? 'text-foreground' : 'text-muted-foreground',
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          'inline-block h-1 w-1 shrink-0 rounded-full',
                          isActive ? 'bg-foreground/70' : 'bg-transparent',
                        )}
                      />
                      <span className="truncate">{label}</span>
                    </button>
                  )
                })}
                <div className="my-1 h-px bg-foreground/[0.06]" />
                <button
                  type="button"
                  onClick={() => handleNew(expandedApp.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                    'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground',
                    'focus-visible:outline-none focus-visible:bg-foreground/[0.06]',
                  )}
                >
                  <Plus className="h-3.5 w-3.5" strokeWidth={2.25} />
                  <span>{t('components.shell.slot.newInstance')}</span>
                </button>
              </div>,
              document.body,
            )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
