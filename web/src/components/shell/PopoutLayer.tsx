import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { POPOUT_SLOT_ID, useRequiredSlotContext } from '@/contexts/SlotContext'
import { useWorkspaceProfile } from '@/stores/workspace-profile-store'
import { Expand, GripHorizontal, PanelTopOpen, Shrink, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppHeaderButton } from './windows/AppHeaderButton'
import { AppHeaderSlotContext } from './windows/AppWindow'

const MIN_W = 240
const MIN_H = 200
const DEFAULT_W = 720
const DEFAULT_H = 520

/**
 * Floating window for popped-out app instances.
 *
 * Owns the full chrome (drag/resize, tab strip, app header portal, window
 * controls) directly — the inner App component is rendered without an
 * AppWindow wrapper, since the popout already provides everything an
 * AppWindow would (border/radius/shadow/header/controls). This avoids the
 * double-chrome look of nesting two windowed surfaces.
 *
 * Apps that inject toolbar content via `useAppHeaderSlot` find the portal
 * target inside the popout's title bar (right of the tab strip).
 */
export function PopoutLayer() {
  const { t } = useTranslation()
  const ctx = useRequiredSlotContext()
  const popout = ctx.getState(POPOUT_SLOT_ID)
  const { popoutGeo, setPopoutGeo, workspaceId: profileId } = ctx
  // Subscribe to the full payload so per-instance label derivations
  // (instances[id] → instanceLabel) re-render when persistent state shifts.
  // `workspaceId` here is the slot-context profile id — fleet scope passes
  // FLEET_PROFILE_ID, ws scope passes the actual workspace id.
  const profile = useWorkspaceProfile(profileId)
  const instancesMap =
    (profile as { instances?: Record<string, Record<string, unknown>> }).instances ?? {}

  const elRef = useRef<HTMLDivElement>(null)
  const [headerSlot, setHeaderSlot] = useState<HTMLDivElement | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  // Live geometry — mutated during drag/resize, committed on pointerup.
  const geo = useRef({
    x: popoutGeo?.x ?? -1,
    y: popoutGeo?.y ?? -1,
    w: popoutGeo?.w ?? DEFAULT_W,
    h: popoutGeo?.h ?? DEFAULT_H,
  })
  const [, bump] = useState(0)

  useEffect(() => {
    if (!popoutGeo) return
    geo.current = { ...popoutGeo }
    applyGeo()
  }, [popoutGeo])

  useEffect(() => {
    if (popout.opened.length > 0 && geo.current.x === -1) {
      geo.current.x = Math.max(40, window.innerWidth - geo.current.w - 40)
      geo.current.y = Math.max(40, window.innerHeight - geo.current.h - 80)
      applyGeo()
      setPopoutGeo({ ...geo.current })
    }
  }, [popout.opened.length, setPopoutGeo])

  useEffect(() => {
    function handler() {
      setIsFullscreen(document.fullscreenElement === elRef.current)
    }
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement === elRef.current) {
      void document.exitFullscreen()
    } else {
      void elRef.current?.requestFullscreen()
    }
  }, [])

  const applyGeo = useCallback(() => {
    const el = elRef.current
    if (!el) return
    el.style.left = `${geo.current.x}px`
    el.style.top = `${geo.current.y}px`
    el.style.width = `${geo.current.w}px`
    el.style.height = `${geo.current.h}px`
  }, [])

  const onPointerDownDrag = useCallback(
    (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest('button, [role="button"]')) return
      e.preventDefault()
      const startX = e.clientX
      const startY = e.clientY
      const origX = geo.current.x
      const origY = geo.current.y

      const onMove = (ev: PointerEvent) => {
        geo.current.x = Math.max(0, origX + ev.clientX - startX)
        geo.current.y = Math.max(0, origY + ev.clientY - startY)
        applyGeo()
      }
      const onUp = () => {
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup', onUp)
        setPopoutGeo({ ...geo.current })
        bump((n) => n + 1)
      }
      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup', onUp)
    },
    [applyGeo, setPopoutGeo],
  )

  const onPointerDownResize = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const startX = e.clientX
      const startY = e.clientY
      const origW = geo.current.w
      const origH = geo.current.h

      const el = elRef.current
      const onMove = (ev: PointerEvent) => {
        geo.current.w = Math.max(MIN_W, origW + ev.clientX - startX)
        geo.current.h = Math.max(MIN_H, origH + ev.clientY - startY)
        if (el) {
          el.style.width = `${geo.current.w}px`
          el.style.height = `${geo.current.h}px`
        }
      }
      const onUp = () => {
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup', onUp)
        setPopoutGeo({ ...geo.current })
        bump((n) => n + 1)
      }
      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup', onUp)
    },
    [setPopoutGeo],
  )

  if (popout.opened.length === 0) return null

  const active = popout.active
  const ActiveApp = active ? ctx.getApp(active.appId) : undefined

  const closeAll = () => {
    for (const inst of [...popout.opened]) {
      ctx.close(POPOUT_SLOT_ID, inst.id)
    }
  }

  return (
    <div
      ref={elRef}
      className="group/popout @container/panel fixed z-50 flex flex-col overflow-hidden rounded-lg border border-border bg-background shadow-2xl"
      style={{
        left: geo.current.x,
        top: geo.current.y,
        width: geo.current.w,
        height: geo.current.h,
        willChange: 'left, top, width, height',
      }}
    >
      <div
        className="flex h-9 shrink-0 cursor-move select-none items-center gap-1 border-b border-border bg-muted/50 px-2"
        onPointerDown={onPointerDownDrag}
      >
        <GripHorizontal className="h-3.5 w-3.5 shrink-0 pointer-events-none text-muted-foreground" />

        <ScrollArea className="min-w-0 flex-1">
          <div className="flex items-center gap-0.5">
            {popout.opened.map((inst) => {
              const app = ctx.getApp(inst.appId)
              const persistent = instancesMap[inst.id] ?? {}
              const derived = app?.instanceLabel?.(persistent) ?? null
              const label = derived ?? app?.label ?? inst.appId
              const isActive = active?.id === inst.id
              return (
                <button
                  type="button"
                  key={inst.id}
                  className={`group flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors ${
                    isActive
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:bg-background/50 hover:text-foreground'
                  }`}
                  onClick={(e) => {
                    e.stopPropagation()
                    ctx.activate(POPOUT_SLOT_ID, inst.id)
                  }}
                  title={label}
                >
                  <span className="max-w-[160px] truncate">{label}</span>
                  {/* biome-ignore lint/a11y/useKeyWithClickEvents: parent <button> handles keyboard; close affordance is mouse-only by design */}
                  <span
                    className="ml-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm opacity-0 transition-opacity hover:bg-muted-foreground/20 group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation()
                      ctx.close(POPOUT_SLOT_ID, inst.id)
                    }}
                    // biome-ignore lint/a11y/useSemanticElements: nested inside parent <button>; <button> nesting is invalid HTML
                    role="button"
                    tabIndex={-1}
                    aria-label={t('components.popout.actions.closeTab')}
                  >
                    <X className="h-2.5 w-2.5" />
                  </span>
                </button>
              )
            })}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>

        {/* App header portal — same surface AppWindow exposes to apps. App
            renders breadcrumbs/buttons here via createPortal. Right-aligns
            so app actions sit just before window controls. */}
        <div ref={setHeaderSlot} className="flex min-w-0 shrink-0 items-center gap-1.5" />

        {/* Window controls — popIn (only for non-hidden), fullscreen, close-all. */}
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover/popout:opacity-100">
          {active && ActiveApp && !ActiveApp.hidden && (
            <AppHeaderButton
              icon={PanelTopOpen}
              aria-label={t('components.shell.window.popIn')}
              title={t('components.shell.window.popIn')}
              onClick={() => ctx.popIn(active.id)}
            />
          )}
          <AppHeaderButton
            icon={isFullscreen ? Shrink : Expand}
            aria-label={t(
              isFullscreen
                ? 'components.shell.window.exitFullscreen'
                : 'components.shell.window.fullscreen',
            )}
            title={t(
              isFullscreen
                ? 'components.shell.window.exitFullscreen'
                : 'components.shell.window.fullscreen',
            )}
            onClick={toggleFullscreen}
          />
          <AppHeaderButton
            icon={X}
            tone="destructive"
            aria-label={t('components.popout.actions.closeAll')}
            title={t('components.popout.actions.closeAll')}
            onClick={closeAll}
          />
        </div>
      </div>

      {active && ActiveApp && (
        <AppHeaderSlotContext.Provider value={headerSlot}>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <ActiveApp.Component key={active.id} instanceId={active.id} />
          </div>
        </AppHeaderSlotContext.Provider>
      )}

      <div
        className="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize"
        onPointerDown={onPointerDownResize}
      >
        <svg className="h-4 w-4 text-muted-foreground/40" viewBox="0 0 16 16" fill="currentColor">
          <title>{t('components.popout.actions.resize')}</title>
          <circle cx="12" cy="12" r="1.5" />
          <circle cx="7" cy="12" r="1.5" />
          <circle cx="12" cy="7" r="1.5" />
        </svg>
      </div>
    </div>
  )
}
