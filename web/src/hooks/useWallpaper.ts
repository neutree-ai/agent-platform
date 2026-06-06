import { FLEET_PROFILE_ID } from '@/stores/fleet-profile'
import { useWorkspaceProfile, useWorkspaceProfileStore } from '@/stores/workspace-profile-store'
import { useCallback } from 'react'

export const WALLPAPERS = ['aurora', 'minimal', 'cool', 'warm'] as const
export type Wallpaper = (typeof WALLPAPERS)[number]
const DEFAULT_WALLPAPER: Wallpaper = 'aurora'

function isWallpaper(v: unknown): v is Wallpaper {
  return typeof v === 'string' && (WALLPAPERS as readonly string[]).includes(v)
}

/** Class name lookup — explicit switch keeps `desktop-wallpaper--*` greppable. */
export function wallpaperClassName(w: Wallpaper): string {
  switch (w) {
    case 'aurora':
      return 'desktop-wallpaper--aurora'
    case 'minimal':
      return 'desktop-wallpaper--minimal'
    case 'cool':
      return 'desktop-wallpaper--cool'
    case 'warm':
      return 'desktop-wallpaper--warm'
  }
}

/** Swatch class for the small circular preview in pickers. Distinct from
 * the full wallpaper class so the thumbnail can use a composition tuned
 * for legibility at ~28px instead of the cropped viewport stack. */
export function wallpaperSwatchClassName(w: Wallpaper): string {
  switch (w) {
    case 'aurora':
      return 'wallpaper-swatch wallpaper-swatch--aurora'
    case 'minimal':
      return 'wallpaper-swatch wallpaper-swatch--minimal'
    case 'cool':
      return 'wallpaper-swatch wallpaper-swatch--cool'
    case 'warm':
      return 'wallpaper-swatch wallpaper-swatch--warm'
  }
}

/**
 * User-level desktop wallpaper preset, persisted on the fleet profile so
 * the choice follows the user across workspaces and devices. Falls back to
 * `aurora` while loading or when unset.
 */
export function useWallpaper(): {
  wallpaper: Wallpaper
  setWallpaper: (w: Wallpaper) => void
} {
  const payload = useWorkspaceProfile(FLEET_PROFILE_ID)
  const stored = (payload as { wallpaper?: unknown }).wallpaper
  const wallpaper = isWallpaper(stored) ? stored : DEFAULT_WALLPAPER

  const setWallpaper = useCallback((w: Wallpaper) => {
    useWorkspaceProfileStore.getState().patch(FLEET_PROFILE_ID, { wallpaper: w })
  }, [])

  return { wallpaper, setWallpaper }
}
