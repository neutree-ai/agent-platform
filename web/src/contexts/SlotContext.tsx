import type { AppDefinition, AppInstance } from '@/lib/app-registry'
import {
  dropInstanceState,
  dropPersistentInstanceState,
  setPersistentInstanceStateMany,
} from '@/stores/instance-state-store'
import { useWorkspaceProfile, useWorkspaceProfileStore } from '@/stores/workspace-profile-store'
import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from 'react'

export interface SlotConfig {
  /** Stable id used to key into the slot map. e.g., 'slot-a'. */
  id: string
  /**
   * App ids opened on first visit when the workspace profile has no entry
   * for this slot. Instance ids are generated lazily on first read. The
   * first item is treated as the active default; the rest are pre-loaded
   * so the slot's tab strip surfaces them right away.
   */
  defaultOpened?: string[]
}

interface SlotState {
  /** Open app instances in this slot — order matches dock display. */
  opened: AppInstance[]
  /** Active instance id, or null when slot is empty. */
  activeId: string | null
  /** Convenience: `opened.find(i => i.id === activeId)`. */
  active: AppInstance | null
}

interface PopoutGeo {
  x: number
  y: number
  w: number
  h: number
}

/**
 * The popout layer is modeled as a virtual slot named `popout`. It uses the
 * same `{ opened, active }` shape as layout slots, so all SlotContext
 * mechanics (open/activate/close, instance state cleanup) reuse identically.
 * It just isn't rendered by any layout — PopoutLayer reads it directly and
 * draws a floating window with tab consolidation across all popped-out
 * instances.
 */
export const POPOUT_SLOT_ID = 'popout'

interface SlotContextValue {
  /**
   * Profile id this provider is bound to. Equal to the workspace id in ws
   * scope, or a synthetic constant in fleet scope. Exposed so per-instance
   * state hooks can read it without depending on URL params (fleet routes
   * have no `:workspaceId` segment).
   */
  workspaceId: string
  slots: SlotConfig[]
  apps: AppDefinition[]
  getApp: (appId: string) => AppDefinition | undefined
  getState: (slotId: string) => SlotState
  /**
   * Open `appId` in the slot — always creates a new instance and activates
   * it. Returns the new instance id. To switch to an already-opened
   * instance, use `activate` (the dock pill click).
   */
  open: (slotId: string, appId: string) => string
  /**
   * Find the first existing instance of `appId` across slots and return
   * its location. If none exists, opens a new one in the first slot and
   * returns that. Used by external callers (markdown links, command
   * palette) that want to route to "the" Files / Browser / etc.
   * Skips the popout slot — popouts are explicit, not implicit.
   */
  ensureInstance: (appId: string) => { slotId: string; instanceId: string }
  /** Activate an already-opened instance by id. */
  activate: (slotId: string, instanceId: string) => void
  /** Remove an instance from the slot. If active, advance to remaining. */
  close: (slotId: string, instanceId: string) => void
  /**
   * When non-null, only this slot is rendered (layout is bypassed). The
   * other slots' state is preserved off-screen. Set to null to restore
   * normal multi-slot layout.
   */
  filledSlot: string | null
  setFilledSlot: (slotId: string | null) => void

  /**
   * Move a slotted instance into the popout layer. The instance keeps its
   * id, so per-instance state (memory + persistent) carries over without
   * remount.
   */
  popOut: (slotId: string, instanceId: string) => void
  /**
   * Move a popped-out instance back into a regular slot. Picks the slot
   * whose layout default lists this app, falling back to slot-a / first.
   */
  popIn: (instanceId: string) => void
  /**
   * Move `instanceId` from `srcSlotId` to `destSlotId`, inserting at
   * `destIndex` (clamped to dest length). Same-slot reorder when
   * `srcSlotId === destSlotId`. Atomic across slots — instance id preserved
   * so per-instance state survives without remount. Dropped instance becomes
   * the dest's active; src activeId falls back to neighbor (close-rule).
   */
  moveInstance: (
    srcSlotId: string,
    destSlotId: string,
    instanceId: string,
    destIndex: number,
  ) => void
  /**
   * Spawn a fresh instance directly into the popout layer with optional
   * persistent-state seed (e.g. `{ viewingPath: '/foo.md' }` for Files).
   * Returns the new instance id.
   */
  openInPopout: (appId: string, seedPersistent?: Record<string, unknown>) => string
  /** Geometry of the floating popout window. Persisted in workspace_profile. */
  popoutGeo: PopoutGeo | null
  setPopoutGeo: (geo: PopoutGeo) => void
}

const SlotContext = createContext<SlotContextValue | null>(null)

export function useSlotContext(): SlotContextValue | null {
  return useContext(SlotContext)
}

export function useRequiredSlotContext(): SlotContextValue {
  const ctx = useContext(SlotContext)
  if (!ctx) throw new Error('SlotContext missing — wrap in <SlotProvider>')
  return ctx
}

interface SlotProviderProps {
  workspaceId: string
  slots: SlotConfig[]
  apps: AppDefinition[]
  /**
   * Slot id where `ensureInstance` lands an unmatched app (i.e. not already
   * opened and not in any slot's `defaultOpened`). Layout-aware — usually
   * the work-surface slot, never the chat/sidecar. Defaults to the first
   * slot when omitted.
   */
  fallbackSlotId?: string
  children: ReactNode
}

interface StoredSlot {
  opened?: AppInstance[]
  active?: string | null
}
type StoredSlots = Record<string, StoredSlot>

function newInstanceId(): string {
  // Crypto-safe enough for state keying; no collision concern at this scale.
  return Math.random().toString(36).slice(2, 10)
}

/**
 * Manages per-slot opened/active state.
 *
 * Both `opened` (instance list) and `activeId` are persisted in
 * `workspace_profile.slots` (DB via the workspace-profile store). Single
 * source of truth — no URL or ls shadowing. Survives refresh / ls clear /
 * cross-device. Per-instance UI state (scroll, cwd, etc.) lives in the
 * separate instance state store, keyed by `AppInstance.id`.
 *
 * The `popout` slot is injected internally and not part of any layout. It
 * holds instances popped out of regular slots (via `popOut`) or spawned
 * directly into the floating layer (via `openInPopout`).
 */
export function SlotProvider({
  workspaceId,
  slots: layoutSlots,
  apps,
  fallbackSlotId,
  children,
}: SlotProviderProps) {
  const [filledSlot, setFilledSlot] = useState<string | null>(null)
  const payload = useWorkspaceProfile(workspaceId)

  // The popout slot is appended internally so it shares all slot machinery
  // (state read/write, instance cleanup) without leaking into layouts.
  const slots = useMemo(() => [...layoutSlots, { id: POPOUT_SLOT_ID }], [layoutSlots])

  const storedSlots = (payload as { slots?: StoredSlots }).slots
  const popoutGeo = ((payload as { popoutGeo?: PopoutGeo }).popoutGeo ?? null) as PopoutGeo | null

  const getApp = useCallback((id: string) => apps.find((a) => a.id === id), [apps])

  const getState = useCallback(
    (slotId: string): SlotState => {
      const cfg = slots.find((s) => s.id === slotId)
      const stored = storedSlots?.[slotId]
      // Seed from layout defaults when nothing stored yet — synthesize stable
      // instance ids on the fly. Defaults are deterministic per (slot, app)
      // so re-renders before first write don't generate new ids each time.
      // The popout slot has no defaultOpened, so it starts empty.
      const seed: AppInstance[] =
        cfg?.defaultOpened?.map((appId) => ({
          id: `${slotId}:${appId}`,
          appId,
        })) ?? []
      const opened = (stored?.opened ?? seed).filter((i) => getApp(i.appId))
      const storedActive = stored?.active
      const activeId =
        storedActive && opened.some((i) => i.id === storedActive)
          ? storedActive
          : (opened[0]?.id ?? null)
      const active = opened.find((i) => i.id === activeId) ?? null
      return { opened, activeId, active }
    },
    [storedSlots, slots, getApp],
  )

  const writeSlot = useCallback(
    (slotId: string, patch: StoredSlot) => {
      const profile = useWorkspaceProfileStore.getState()
      const cur = (profile.byWorkspace[workspaceId] as { slots?: StoredSlots } | undefined)?.slots
      const nextEntry: StoredSlot = { ...(cur?.[slotId] ?? {}), ...patch }
      const nextSlots: StoredSlots = { ...(cur ?? {}), [slotId]: nextEntry }
      profile.patch(workspaceId, { slots: nextSlots })
    },
    [workspaceId],
  )

  /**
   * Multi-slot atomic write. Used by popOut/popIn so removing from one slot
   * and adding to another is one debounced PATCH (and one local-state
   * update), avoiding a transient state where the instance exists in
   * neither — which the `key={instance.id}` remount in SlotContainer would
   * otherwise interpret as "instance gone, unmount".
   */
  const writeSlots = useCallback(
    (patches: Record<string, StoredSlot>) => {
      const profile = useWorkspaceProfileStore.getState()
      const cur =
        (profile.byWorkspace[workspaceId] as { slots?: StoredSlots } | undefined)?.slots ?? {}
      const next: StoredSlots = { ...cur }
      for (const [slotId, patch] of Object.entries(patches)) {
        next[slotId] = { ...(cur[slotId] ?? {}), ...patch }
      }
      profile.patch(workspaceId, { slots: next })
    },
    [workspaceId],
  )

  const open = useCallback(
    (slotId: string, appId: string): string => {
      const cur = getState(slotId).opened
      const fresh: AppInstance = { id: newInstanceId(), appId }
      writeSlot(slotId, { opened: [...cur, fresh], active: fresh.id })
      return fresh.id
    },
    [getState, writeSlot],
  )

  const activate = useCallback(
    (slotId: string, instanceId: string) => {
      writeSlot(slotId, { active: instanceId })
    },
    [writeSlot],
  )

  const ensureInstance = useCallback(
    (appId: string): { slotId: string; instanceId: string } => {
      // Don't surface popout instances — external callers (markdown link,
      // command palette) want to land in a regular slot.
      for (const slot of layoutSlots) {
        const existing = getState(slot.id).opened.find((i) => i.appId === appId)
        if (existing) return { slotId: slot.id, instanceId: existing.id }
      }
      const preferred = layoutSlots.find((s) => s.defaultOpened?.includes(appId))
      // Resolution order: defaultOpened match → layout-aware fallback (work
      // slot, set by Desktop) → first slot. The fallback only kicks in for
      // apps not anchored anywhere — chat / sessions stay on their column.
      const fallback = layoutSlots.find((s) => s.id === fallbackSlotId)?.id ?? layoutSlots[0]?.id
      const slotId = preferred?.id ?? fallback
      if (!slotId) throw new Error(`ensureInstance(${appId}): no slots configured`)
      const instanceId = open(slotId, appId)
      return { slotId, instanceId }
    },
    [layoutSlots, fallbackSlotId, getState, open],
  )

  const close = useCallback(
    (slotId: string, instanceId: string) => {
      const { opened, activeId } = getState(slotId)
      const idx = opened.findIndex((i) => i.id === instanceId)
      const nextOpened = opened.filter((i) => i.id !== instanceId)
      // Focus the previous tab (IDE/browser convention); if closing the
      // first tab, the next one becomes active. Untouched when closing a
      // non-active tab.
      let nextActive: string | null = activeId
      if (activeId === instanceId) {
        if (nextOpened.length === 0) nextActive = null
        else if (idx > 0) nextActive = opened[idx - 1].id
        else nextActive = nextOpened[0].id
      }
      writeSlot(slotId, { opened: nextOpened, active: nextActive })
      // If this slot was filling the shell and we just closed its last
      // instance, drop the fill — otherwise `filledSlot` dangles on an empty
      // slot and WorkspacePage renders only that (blank) slot, hiding every
      // other window until a manual refresh.
      if (nextOpened.length === 0) {
        setFilledSlot((f) => (f === slotId ? null : f))
      }
      dropInstanceState(workspaceId, instanceId)
      dropPersistentInstanceState(workspaceId, instanceId)
    },
    [getState, writeSlot, workspaceId],
  )

  const popOut = useCallback(
    (slotId: string, instanceId: string) => {
      if (slotId === POPOUT_SLOT_ID) return
      const src = getState(slotId)
      const inst = src.opened.find((i) => i.id === instanceId)
      if (!inst) return
      const popout = getState(POPOUT_SLOT_ID)
      const nextSrcOpened = src.opened.filter((i) => i.id !== instanceId)
      const nextSrcActive =
        src.activeId === instanceId ? (nextSrcOpened[0]?.id ?? null) : src.activeId
      writeSlots({
        [slotId]: { opened: nextSrcOpened, active: nextSrcActive },
        [POPOUT_SLOT_ID]: { opened: [...popout.opened, inst], active: inst.id },
      })
    },
    [getState, writeSlots],
  )

  const popIn = useCallback(
    (instanceId: string) => {
      const popout = getState(POPOUT_SLOT_ID)
      const inst = popout.opened.find((i) => i.id === instanceId)
      if (!inst) return
      // Hidden apps (e.g., the file viewer) have no dock/picker presence;
      // returning one to a layout slot would orphan it (no way to reopen
      // after closing). They live and die in the popout layer.
      if (getApp(inst.appId)?.hidden) return
      // Pick destination by layout default; fall back to first layout slot.
      const preferred = layoutSlots.find((s) => s.defaultOpened?.includes(inst.appId))
      const destId = preferred?.id ?? layoutSlots[0]?.id
      if (!destId) return
      const dest = getState(destId)
      const nextPopOpened = popout.opened.filter((i) => i.id !== instanceId)
      const nextPopActive =
        popout.activeId === instanceId ? (nextPopOpened[0]?.id ?? null) : popout.activeId
      writeSlots({
        [POPOUT_SLOT_ID]: { opened: nextPopOpened, active: nextPopActive },
        [destId]: { opened: [...dest.opened, inst], active: inst.id },
      })
    },
    [getState, layoutSlots, writeSlots],
  )

  const moveInstance = useCallback(
    (srcSlotId: string, destSlotId: string, instanceId: string, destIndex: number) => {
      const src = getState(srcSlotId)
      const inst = src.opened.find((i) => i.id === instanceId)
      if (!inst) return

      // Same-slot reorder: single writeSlot, recompute active only if needed
      // (active stays the same instance — we just shuffle order).
      if (srcSlotId === destSlotId) {
        const without = src.opened.filter((i) => i.id !== instanceId)
        const clamped = Math.max(0, Math.min(destIndex, without.length))
        const next = [...without.slice(0, clamped), inst, ...without.slice(clamped)]
        writeSlot(srcSlotId, { opened: next, active: src.activeId })
        return
      }

      // Cross-slot: remove from src, insert into dest, atomic.
      const dest = getState(destSlotId)
      const nextSrcOpened = src.opened.filter((i) => i.id !== instanceId)
      // Apply close-rule for src active fallback.
      const idx = src.opened.findIndex((i) => i.id === instanceId)
      let nextSrcActive: string | null = src.activeId
      if (src.activeId === instanceId) {
        if (nextSrcOpened.length === 0) nextSrcActive = null
        else if (idx > 0) nextSrcActive = src.opened[idx - 1].id
        else nextSrcActive = nextSrcOpened[0].id
      }
      const clamped = Math.max(0, Math.min(destIndex, dest.opened.length))
      const nextDestOpened = [...dest.opened.slice(0, clamped), inst, ...dest.opened.slice(clamped)]
      writeSlots({
        [srcSlotId]: { opened: nextSrcOpened, active: nextSrcActive },
        [destSlotId]: { opened: nextDestOpened, active: instanceId },
      })
    },
    [getState, writeSlot, writeSlots],
  )

  const openInPopout = useCallback(
    (appId: string, seedPersistent?: Record<string, unknown>): string => {
      const id = newInstanceId()
      if (seedPersistent) {
        setPersistentInstanceStateMany(workspaceId, id, seedPersistent)
      }
      const cur = getState(POPOUT_SLOT_ID).opened
      writeSlot(POPOUT_SLOT_ID, { opened: [...cur, { id, appId }], active: id })
      return id
    },
    [getState, writeSlot, workspaceId],
  )

  const setPopoutGeoCb = useCallback(
    (geo: PopoutGeo) => {
      useWorkspaceProfileStore.getState().patch(workspaceId, { popoutGeo: geo })
    },
    [workspaceId],
  )

  const value = useMemo<SlotContextValue>(
    () => ({
      workspaceId,
      // Expose only the layout slots externally — popout is an
      // implementation detail surfaced via the dedicated popout API.
      slots: layoutSlots,
      apps,
      getApp,
      getState,
      open,
      ensureInstance,
      activate,
      close,
      filledSlot,
      setFilledSlot,
      popOut,
      popIn,
      openInPopout,
      moveInstance,
      popoutGeo,
      setPopoutGeo: setPopoutGeoCb,
    }),
    [
      workspaceId,
      layoutSlots,
      apps,
      getApp,
      getState,
      open,
      ensureInstance,
      activate,
      close,
      filledSlot,
      popOut,
      popIn,
      openInPopout,
      moveInstance,
      popoutGeo,
      setPopoutGeoCb,
    ],
  )

  return <SlotContext.Provider value={value}>{children}</SlotContext.Provider>
}
