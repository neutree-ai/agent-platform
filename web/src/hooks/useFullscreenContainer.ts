import { useEffect, useState } from 'react'

/**
 * Returns the current HTML fullscreen element (or null when not in fullscreen).
 *
 * Radix portals (Select / Popover / DropdownMenu content) default to
 * `document.body`, which lives OUTSIDE the element passed to
 * `requestFullscreen()`. While a window/popout is fullscreen, only that
 * element's subtree is rendered, so portaled dropdowns/popovers become
 * invisible and non-interactive. Pass this value as the Portal `container`
 * so portaled content mounts inside the fullscreen subtree instead.
 *
 * When not in fullscreen this returns null and Radix falls back to
 * `document.body`, preserving default behavior.
 */
export function useFullscreenContainer(): HTMLElement | null {
  const [container, setContainer] = useState<HTMLElement | null>(
    () => (document.fullscreenElement as HTMLElement | null) ?? null,
  )

  useEffect(() => {
    function handler() {
      setContainer((document.fullscreenElement as HTMLElement | null) ?? null)
    }
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  return container
}
