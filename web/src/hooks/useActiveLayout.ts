import { DEFAULT_LAYOUT, type LayoutId, isLayoutId } from '@/components/shell/layout/layouts'
import { useWorkspaceProfile, useWorkspaceProfileStore } from '@/stores/workspace-profile-store'
import { useCallback } from 'react'

interface ActiveLayoutOptions {
  /** Restrict accepted ids — anything stored outside this set falls back to defaultId. */
  allowed?: readonly LayoutId[]
  /** Fallback when stored value is missing or not in `allowed`. */
  defaultId?: LayoutId
}

/**
 * Active layout for the given profile (workspace UUID for ws scope, the
 * synthetic FLEET_PROFILE_ID for fleet scope).
 *
 * Single source of truth: `<profile>.layout_id`, persisted via the
 * workspace-profile store. Survives refresh / ls clear / cross-device.
 * Falls back to `defaultId` (or DEFAULT_LAYOUT) while loading or unset.
 */
export function useActiveLayout(
  profileId: string | undefined,
  options?: ActiveLayoutOptions,
): {
  layoutId: LayoutId
  setLayoutId: (id: LayoutId) => void
} {
  const allowed = options?.allowed
  const fallback = options?.defaultId ?? DEFAULT_LAYOUT
  const payload = useWorkspaceProfile(profileId)
  const stored = (payload as { layout_id?: unknown }).layout_id
  const isStoredId = typeof stored === 'string' && isLayoutId(stored)
  const layoutId =
    isStoredId && (!allowed || allowed.includes(stored as LayoutId))
      ? (stored as LayoutId)
      : fallback

  const setLayoutId = useCallback(
    (id: LayoutId) => {
      if (!profileId) return
      useWorkspaceProfileStore.getState().patch(profileId, { layout_id: id })
    },
    [profileId],
  )

  return { layoutId, setLayoutId }
}
