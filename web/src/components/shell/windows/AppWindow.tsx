import { cn } from '@/lib/utils'
import { Expand, ExternalLink, Maximize2, Minimize2, PanelTopOpen, Shrink, X } from 'lucide-react'
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { AppHeaderButton } from './AppHeaderButton'

interface AppWindowProps {
  children: ReactNode
  /** Close handler — invoked by the X control. */
  onClose?: () => void
  /**
   * Pop-out handler — meaning depends on `popoutMode`:
   *  - 'out' (default in slots): move this instance into the floating popout layer
   *  - 'in' (used by PopoutLayer): move this instance back into a regular slot
   */
  onPopOut?: () => void
  /** Visual mode for the pop-out button. Default: 'out'. */
  popoutMode?: 'out' | 'in'
  /**
   * Toggle layout-fill: when called, this app should fill the layout
   * (other slots hidden). Caller manages `isFilled`.
   */
  onFill?: () => void
  /** Whether this window is currently filling the layout. */
  isFilled?: boolean
  className?: string
}

/**
 * Apps inject their header content (title, selectors, app-specific actions)
 * into the AppWindow header by reading `useAppHeaderSlot()` and rendering
 * via React portal. This keeps the app self-contained while letting the
 * shell own the chrome.
 *
 * Convention: render business actions left-aligned (the slot is a left-
 * flex region). Do not pad with counts / status strings to "fill" the
 * header — empty space is fine. Window controls live to the right and
 * are managed by the shell.
 */
export const AppHeaderSlotContext = createContext<HTMLDivElement | null>(null)

export function useAppHeaderSlot(): HTMLDivElement | null {
  return useContext(AppHeaderSlotContext)
}

/**
 * AppWindow — universal container for an app rendered within a Layout slot.
 * Provides chrome (border, bg, radius, shadow), a persistent thin header
 * with hover-only window controls, and a body region. The header's left
 * region is exposed to apps via the `useAppHeaderSlot` portal target.
 */
export function AppWindow({
  children,
  onClose,
  onPopOut,
  popoutMode = 'out',
  onFill,
  isFilled,
  className,
}: AppWindowProps) {
  const [headerSlot, setHeaderSlot] = useState<HTMLDivElement | null>(null)
  const sectionRef = useRef<HTMLElement>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    function handler() {
      setIsFullscreen(document.fullscreenElement === sectionRef.current)
    }
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement === sectionRef.current) {
      void document.exitFullscreen()
    } else {
      void sectionRef.current?.requestFullscreen()
    }
  }, [])

  return (
    <section
      ref={sectionRef}
      className={cn(
        'group/appwindow @container/panel relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
        'rounded-lg border border-foreground/[0.08] bg-card',
        'shadow-xl dark:ring-1 dark:ring-inset dark:ring-foreground/[0.04]',
        'transition-shadow duration-300 ease-out hover:shadow-2xl',
        className,
      )}
    >
      <header
        className={cn(
          'flex h-9 shrink-0 items-center gap-2 px-2',
          'border-b border-foreground/[0.06] bg-foreground/[0.06]',
        )}
      >
        {/* App header portal target — apps render content here via
            useAppHeaderSlot + createPortal. Flexes to fill, truncates when
            space is tight. */}
        <div ref={setHeaderSlot} className="flex min-w-0 flex-1 items-center gap-1.5" />
        {/* Window controls — always rendered, always rightmost. Hover-visible
            so they don't compete with app content. */}
        <WindowControls
          onClose={onClose}
          onPopOut={onPopOut}
          popoutMode={popoutMode}
          onFill={onFill}
          isFilled={isFilled}
          isFullscreen={isFullscreen}
          onToggleFullscreen={toggleFullscreen}
        />
      </header>
      <AppHeaderSlotContext.Provider value={headerSlot}>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      </AppHeaderSlotContext.Provider>
    </section>
  )
}

interface WindowControlsProps {
  onClose?: () => void
  onPopOut?: () => void
  popoutMode: 'out' | 'in'
  onFill?: () => void
  isFilled?: boolean
  isFullscreen: boolean
  onToggleFullscreen: () => void
}

function WindowControls({
  onClose,
  onPopOut,
  popoutMode,
  onFill,
  isFilled,
  isFullscreen,
  onToggleFullscreen,
}: WindowControlsProps) {
  const { t } = useTranslation()

  return (
    <div
      className={cn(
        'flex shrink-0 items-center gap-0.5',
        'opacity-0 transition-opacity duration-150',
        'group-hover/appwindow:opacity-100',
      )}
    >
      {onPopOut && (
        <AppHeaderButton
          icon={popoutMode === 'in' ? PanelTopOpen : ExternalLink}
          aria-label={t(
            popoutMode === 'in'
              ? 'components.shell.window.popIn'
              : 'components.shell.window.popOut',
          )}
          title={t(
            popoutMode === 'in'
              ? 'components.shell.window.popIn'
              : 'components.shell.window.popOut',
          )}
          onClick={onPopOut}
        />
      )}
      {onFill && (
        <AppHeaderButton
          icon={isFilled ? Minimize2 : Maximize2}
          aria-label={t(
            isFilled ? 'components.shell.window.unfill' : 'components.shell.window.fill',
          )}
          title={t(isFilled ? 'components.shell.window.unfill' : 'components.shell.window.fill')}
          onClick={onFill}
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
        onClick={onToggleFullscreen}
      />
      <AppHeaderButton
        icon={X}
        tone="destructive"
        aria-label={t('components.shell.window.close')}
        title={t('components.shell.window.close')}
        onClick={onClose}
      />
    </div>
  )
}
