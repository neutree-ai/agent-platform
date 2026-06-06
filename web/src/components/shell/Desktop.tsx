import { ChunkErrorBoundary } from '@/components/ChunkErrorBoundary'
import { CommandPalette } from '@/components/CommandPalette'
import { DialogStackProvider } from '@/contexts/DialogStackContext'
import { type SlotConfig, SlotProvider } from '@/contexts/SlotContext'
import { useActiveLayout } from '@/hooks/useActiveLayout'
import { useFleetApps } from '@/hooks/useFleetApps'
import { useWallpaper, wallpaperClassName } from '@/hooks/useWallpaper'
import { useWsApps } from '@/hooks/useWsApps'
import { FLEET_PROFILE_ID } from '@/stores/fleet-profile'
import {
  useWorkspaceProfileLoaded,
  useWorkspaceProfileStore,
} from '@/stores/workspace-profile-store'
import { type ReactNode, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useParams } from 'react-router-dom'
import { Dock } from './Dock'
import { Menubar } from './Menubar'
import { PopoutLayer } from './PopoutLayer'
import {
  FLEET_DEFAULT_LAYOUT,
  FLEET_LAYOUT_IDS,
  LAYOUTS,
  getFallbackSlotId,
} from './layout/layouts'

/**
 * Fleet slot configs, keyed by layout. 2col is the historical default —
 * slot-a is the launcher column (workspaces + platform-config apps), slot-b
 * is the Activity sidecar. 1col collapses to a single launcher; Activity
 * stays available in slot-a's dock so users can still focus it.
 */
const FLEET_SLOTS_2COL: SlotConfig[] = [
  {
    id: 'slot-a',
    defaultOpened: ['workspaces', 'library', 'connectors', 'credentials', 'models'],
  },
  { id: 'slot-b', defaultOpened: ['activity'] },
]

const FLEET_SLOTS_1COL: SlotConfig[] = [
  {
    id: 'slot-a',
    defaultOpened: ['workspaces', 'library', 'connectors', 'credentials', 'models', 'activity'],
  },
]

interface DesktopProps {
  children: ReactNode
}

export type Scope = 'fleet' | 'ws'

export function Desktop({ children }: DesktopProps) {
  const { t } = useTranslation()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const location = useLocation()
  const params = useParams<{ workspaceId?: string }>()

  const scope: Scope = location.pathname.startsWith('/w/') ? 'ws' : 'fleet'
  const workspaceId = params.workspaceId
  const wsApps = useWsApps(workspaceId)
  const fleetApps = useFleetApps()
  // The profile id drives both data load and SlotProvider keying. In fleet
  // scope it's a synthetic constant; backend lives in fleet-profile.ts.
  const profileId = scope === 'ws' ? workspaceId : FLEET_PROFILE_ID
  const { layoutId } = useActiveLayout(
    profileId,
    scope === 'fleet' ? { allowed: FLEET_LAYOUT_IDS, defaultId: FLEET_DEFAULT_LAYOUT } : undefined,
  )
  const profileLoaded = useWorkspaceProfileLoaded(profileId)
  // Suppress slot/layout/dock rendering until the profile has been fetched
  // at least once — otherwise we'd flash defaults before snapping to the
  // user's saved choice.
  const slotConfig = useMemo(() => {
    if (!profileLoaded) return null
    const fallbackSlotId = getFallbackSlotId(layoutId)
    if (scope === 'ws' && workspaceId) {
      return {
        slots: LAYOUTS[layoutId].slots,
        apps: wsApps,
        id: workspaceId,
        fallbackSlotId,
      }
    }
    if (scope === 'fleet') {
      const slots = layoutId === '1col' ? FLEET_SLOTS_1COL : FLEET_SLOTS_2COL
      return { slots, apps: fleetApps, id: FLEET_PROFILE_ID, fallbackSlotId }
    }
    return null
  }, [scope, workspaceId, profileLoaded, wsApps, fleetApps, layoutId])

  // Bootstrap UI profile (layout + slot opened state).
  // Always load the fleet profile too: user-global settings (chat send key,
  // wallpaper) live on FLEET_PROFILE_ID and are read regardless of scope, so
  // a hard refresh on /w/:id must still hydrate it. ensureLoaded is idempotent.
  useEffect(() => {
    const store = useWorkspaceProfileStore.getState()
    store.ensureLoaded(FLEET_PROFILE_ID)
    if (profileId && profileId !== FLEET_PROFILE_ID) store.ensureLoaded(profileId)
  }, [profileId])

  // Global ⌘K / Ctrl+K toggles the command palette. Skip when focused
  // element is itself a cmdk/dialog input (so palette typing isn't hijacked).
  const togglePalette = useCallback(() => setPaletteOpen((v) => !v), [])
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = navigator.platform?.includes('Mac') ? e.metaKey : e.ctrlKey
      if (mod && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        togglePalette()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePalette])

  const { wallpaper } = useWallpaper()

  const shell = (
    <div
      className={`desktop-wallpaper ${wallpaperClassName(wallpaper)} flex h-svh flex-col overflow-hidden`}
    >
      <Menubar
        scope={scope}
        workspaceId={workspaceId}
        onOpenCommandPalette={() => setPaletteOpen(true)}
      />
      <main className="min-h-0 flex-1">
        <ChunkErrorBoundary>
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-muted-foreground">
                {t('common.loading')}
              </div>
            }
          >
            {children}
          </Suspense>
        </ChunkErrorBoundary>
      </main>
      <Dock scope={scope} workspaceId={workspaceId} />
    </div>
  )

  const palette = <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />

  return (
    <DialogStackProvider>
      {slotConfig ? (
        <SlotProvider
          workspaceId={slotConfig.id}
          slots={slotConfig.slots}
          apps={slotConfig.apps}
          fallbackSlotId={slotConfig.fallbackSlotId}
        >
          {shell}
          {/* Fleet scope: PopoutLayer mounts here so floating windows survive
              outside any per-page provider. WS scope mounts its own copy
              inside WorkspacePage (under AgentSessionProvider) so chat-like
              apps in popout still find session context. */}
          {scope === 'fleet' && <PopoutLayer />}
          {/* Palette lives inside SlotProvider so its app source can read
              the slot context (resolved apps + ensureInstance/activate). */}
          {palette}
        </SlotProvider>
      ) : (
        <>
          {shell}
          {palette}
        </>
      )}
    </DialogStackProvider>
  )
}
