import { DEFAULT_LAYOUT, LAYOUTS, type LayoutId } from '@/components/shell/layout/layouts'
import { useRequiredSlotContext } from '@/contexts/SlotContext'
import { api } from '@/lib/api/client'
import type { ApiWorkspaceLayout } from '@/lib/api/types'
import { useWorkspaceProfile, useWorkspaceProfileStore } from '@/stores/workspace-profile-store'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'
import {
  type LayoutSkeleton,
  POPOUT_SLOT_ID,
  layoutSkeletonEqual,
  normalizeLayoutSkeleton,
  skeletonToProfilePatch,
} from '@neutree-ai/types'
import { useWorkspaceLayouts, workspaceLayoutsQueryKey } from './useWorkspaceLayouts'

type LayoutKind = 'builtin' | 'template' | 'custom'
type LayoutSyncState = 'same' | 'edited'

/**
 * The runtime-only built-in default for a given column frame: that frame with
 * each slot's default apps. Cached per frame so identity is stable across
 * renders. These three are the built-in default presets (1/2/3-col).
 */
const builtinSkeletonCache = new Map<LayoutId, LayoutSkeleton>()
function builtinSkeletonFor(id: LayoutId): LayoutSkeleton {
  let s = builtinSkeletonCache.get(id)
  if (!s) {
    s = normalizeLayoutSkeleton({
      layout_id: id,
      slots: Object.fromEntries(
        LAYOUTS[id].slots.map((slot) => [slot.id, slot.defaultOpened ?? []]),
      ),
    })
    builtinSkeletonCache.set(id, s)
  }
  return s
}

const mkInstanceId = (slotId: string, appId: string, i: number) =>
  `${slotId}:${appId}:${i}:${crypto.randomUUID().slice(0, 8)}`

interface LayoutState {
  /** Current live arrangement as a normalized skeleton. */
  real: LayoutSkeleton
  /** The selected reference (a saved layout, or the built-in default). */
  selected: LayoutSkeleton
  selectedLayout: ApiWorkspaceLayout | null
  selectedId: string | null
  kind: LayoutKind
  state: LayoutSyncState
  /** Apply a saved layout to this workspace (stamp + select). */
  apply: (layout: ApiWorkspaceLayout) => void
  /** Select the built-in default preset for a given column frame. */
  applyBuiltinFrame: (frameId: LayoutId) => void
  /** Discard edits — re-stamp the selected reference onto the live arrangement. */
  reset: () => void
  /** Capture the live arrangement as a new owned layout; select it. */
  saveAsNew: (name: string, description?: string) => Promise<ApiWorkspaceLayout>
  /** Write the live arrangement back into the selected custom layout. */
  updateSelected: () => Promise<void>
}

/**
 * The workspace layout finite state machine (see tmp/layout-fsm).
 *
 * `real` (live profile arrangement) vs `selected` (a saved layout or the
 * built-in default) → `same` | `edited`. Editing actions branch on the
 * selected layout's `kind`: a preset (built-in / template-origin) can only be
 * forked via `saveAsNew`; a `custom` (the user's own) can also be updated in
 * place. Must be used inside a SlotProvider.
 */
export function useLayoutState(workspaceId: string): LayoutState {
  const ctx = useRequiredSlotContext()
  const profile = useWorkspaceProfile(workspaceId)
  const { layouts } = useWorkspaceLayouts()
  const qc = useQueryClient()

  const layoutId = (
    typeof profile.layout_id === 'string' ? profile.layout_id : DEFAULT_LAYOUT
  ) as LayoutId

  const real = useMemo(() => {
    const slots: Record<string, string[]> = {}
    for (const slot of ctx.slots) {
      if (slot.id === POPOUT_SLOT_ID) continue
      const apps = ctx.getState(slot.id).opened.map((i) => i.appId)
      if (apps.length > 0) slots[slot.id] = apps
    }
    return normalizeLayoutSkeleton({ layout_id: layoutId, slots })
  }, [ctx.slots, ctx.getState, layoutId])

  const selectedId =
    typeof profile.selected_layout_id === 'string' ? profile.selected_layout_id : null
  const selectedLayout = selectedId ? (layouts.find((l) => l.id === selectedId) ?? null) : null
  const selected = selectedLayout
    ? normalizeLayoutSkeleton(selectedLayout.skeleton)
    : builtinSkeletonFor(layoutId)
  const kind: LayoutKind = !selectedLayout
    ? 'builtin'
    : selectedLayout.origin === 'template'
      ? 'template'
      : 'custom'
  const state: LayoutSyncState = layoutSkeletonEqual(real, selected) ? 'same' : 'edited'

  const stamp = useCallback(
    (skeleton: LayoutSkeleton, selected_layout_id: string | null) => {
      useWorkspaceProfileStore.getState().patch(workspaceId, {
        selected_layout_id,
        // Skeleton-only reuse: drop per-instance accumulated state on (re)stamp.
        instances: {},
        ...skeletonToProfilePatch(normalizeLayoutSkeleton(skeleton), mkInstanceId),
      })
    },
    [workspaceId],
  )

  const apply = useCallback(
    (layout: ApiWorkspaceLayout) => stamp(layout.skeleton, layout.id),
    [stamp],
  )
  const applyBuiltinFrame = useCallback(
    (frameId: LayoutId) => stamp(builtinSkeletonFor(frameId), null),
    [stamp],
  )
  const reset = useCallback(() => stamp(selected, selectedId), [stamp, selected, selectedId])

  const saveAsNew = useCallback(
    async (name: string, description?: string) => {
      const created = await api.createWorkspaceLayout({ name, description, skeleton: real })
      // real already equals the new layout → just point selection at it (→ same).
      useWorkspaceProfileStore.getState().patch(workspaceId, { selected_layout_id: created.id })
      await qc.invalidateQueries({ queryKey: workspaceLayoutsQueryKey })
      return created
    },
    [real, workspaceId, qc],
  )

  const updateSelected = useCallback(async () => {
    if (!selectedLayout || selectedLayout.origin === 'template') return
    await api.updateWorkspaceLayout(selectedLayout.id, { skeleton: real })
    await qc.invalidateQueries({ queryKey: workspaceLayoutsQueryKey })
  }, [selectedLayout, real, qc])

  return {
    real,
    selected,
    selectedLayout,
    selectedId,
    kind,
    state,
    apply,
    applyBuiltinFrame,
    reset,
    saveAsNew,
    updateSelected,
  }
}
