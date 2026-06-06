import { useCallback, useEffect, useRef, useState } from 'react'

type Direction = 'left' | 'right' | 'top' | 'bottom'

interface UseResizablePanelOptions {
  direction: Direction
  min: number
  /**
   * Optional upper bound. Either a fixed pixel value or a callback that
   * computes max from the container's current size — use the callback form
   * when "max" depends on sibling panels (e.g. "leave 320px for slot-a").
   * If omitted, only `min` clamps the size.
   */
  max?: number | ((containerSize: number) => number)
  storageKey: string
  defaultSize: number
}

const isHorizontal = (d: Direction) => d === 'left' || d === 'right'

export function useResizablePanel({
  direction,
  min,
  max,
  storageKey,
  defaultSize,
}: UseResizablePanelOptions) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState(() => Number(localStorage.getItem(storageKey)) || defaultSize)
  // Keep latest `max` in a ref so the mousemove closure always sees current
  // sibling sizes (callers typically pass a closure that reads other refs).
  const maxRef = useRef(max)
  maxRef.current = max

  // Re-clamp `size` against the live container dimension whenever the
  // container resizes (window resize, monitor swap, devtools open, etc.).
  // We only update the in-memory state — never write back to localStorage —
  // so the user's last explicit drag value is preserved and will be restored
  // if the viewport later grows back.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const horizontal = isHorizontal(direction)

    const clampToContainer = () => {
      const containerSize = horizontal ? el.offsetWidth : el.offsetHeight
      const m = maxRef.current
      const maxSize = typeof m === 'function' ? m(containerSize) : (m ?? Number.POSITIVE_INFINITY)
      const lowerBound = Math.min(min, maxSize)
      setSize((prev) => {
        const next = Math.max(lowerBound, Math.min(prev, maxSize))
        return next === prev ? prev : next
      })
    }

    // Initial pass — handles the mount-time case where the persisted size
    // is already larger than the current container allows.
    clampToContainer()

    const observer = new ResizeObserver(clampToContainer)
    observer.observe(el)
    return () => observer.disconnect()
  }, [direction, min])

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const horizontal = isHorizontal(direction)
      const startPos = horizontal ? e.clientX : e.clientY
      const startSize = size
      const sign = direction === 'left' || direction === 'top' ? 1 : -1

      const onMouseMove = (ev: MouseEvent) => {
        const containerSize = containerRef.current
          ? horizontal
            ? containerRef.current.offsetWidth
            : containerRef.current.offsetHeight
          : horizontal
            ? 800
            : 500
        const m = maxRef.current
        const maxSize = typeof m === 'function' ? m(containerSize) : (m ?? Number.POSITIVE_INFINITY)
        const delta = ((horizontal ? ev.clientX : ev.clientY) - startPos) * sign
        setSize(Math.max(min, Math.min(startSize + delta, maxSize)))
      }

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        for (const f of iframes) f.style.pointerEvents = ''
        setSize((s) => {
          localStorage.setItem(storageKey, String(s))
          return s
        })
      }

      document.body.style.cursor = horizontal ? 'col-resize' : 'row-resize'
      document.body.style.userSelect = 'none'
      // Iframes capture mouse events when the pointer enters them, breaking
      // document-level mousemove tracking during a drag. Disable pointer
      // events on all iframes for the duration of the drag.
      const iframes = document.querySelectorAll<HTMLElement>('iframe')
      for (const f of iframes) f.style.pointerEvents = 'none'
      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [direction, min, storageKey, size],
  )

  return { containerRef, size, onMouseDown }
}
