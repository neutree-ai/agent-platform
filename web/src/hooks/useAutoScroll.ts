import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Manages auto-scroll-to-bottom for a chat message list.
 *
 * Returns:
 * - `scrollRef` — attach to the scrollable container
 * - `showScrollBtn` — whether the "scroll to bottom" button should be visible
 * - `scrollToBottom` — imperative scroll-to-bottom
 * - `markPendingScroll` — call before sending a message so the next render scrolls down
 *
 * `resetKey` (optional): when its value changes, re-arm auto-scroll so the next
 * render lands at the bottom (e.g. switching sessions without unmounting).
 *
 * Design notes (vs. the naive "scroll on deps change" version):
 *  - A ResizeObserver pins the view to the bottom whenever content grows
 *    while armed. This catches async growth that doesn't go through React
 *    deps — image loads, syntax highlighters, virtualizer re-measures, tool
 *    renderers that expand after their initial commit.
 *  - The `auto` flag is only disarmed on *user-initiated* movement (wheel,
 *    touchmove, keyboard). Plain scroll events fire from layout shifts too,
 *    and disarming on those used to break the follow-the-tail behaviour
 *    whenever a long block rendered.
 *  - Returning to the bottom (by any means) re-arms `auto`, so a single
 *    detour up doesn't permanently break follow.
 */
export function useAutoScroll(deps: unknown[], resetKey?: unknown) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const pendingRef = useRef(false)
  const autoRef = useRef(true)
  const [showScrollBtn, setShowScrollBtn] = useState(false)

  const isAtBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el) return true
    return el.scrollTop + el.clientHeight >= el.scrollHeight - 50
  }, [])

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  // Scroll listener: only updates button visibility. It must NOT touch
  // autoRef — layout shifts (tool render expanding, virtualizer remeasure)
  // also fire scroll, and toggling auto from there caused both flaky
  // follow-the-tail (when disarming) and a tug-of-war flicker against
  // small wheel scrolls (when re-arming inside the 50px tolerance).
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => {
      const atBottom = isAtBottom()
      setShowScrollBtn(!atBottom && el.scrollHeight > el.clientHeight)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [isAtBottom])

  // User-intent: wheel / touchmove / keyboard. After the event settles
  // (next frame), let the final position decide: at bottom → arm follow,
  // otherwise → disarm. All non-intent scroll activity (programmatic,
  // layout-driven) leaves autoRef alone.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onIntent = () => {
      requestAnimationFrame(() => {
        autoRef.current = isAtBottom()
      })
    }
    el.addEventListener('wheel', onIntent, { passive: true })
    el.addEventListener('touchmove', onIntent, { passive: true })
    el.addEventListener('keydown', onIntent)
    return () => {
      el.removeEventListener('wheel', onIntent)
      el.removeEventListener('touchmove', onIntent)
      el.removeEventListener('keydown', onIntent)
    }
  }, [isAtBottom])

  // ResizeObserver on the scroll container's children: re-pin to bottom on
  // any content height change while armed. A MutationObserver re-observes
  // newly added direct children so swaps (empty-state ↔ list, flat ↔
  // virtualized) don't lose tracking.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      if (autoRef.current) scrollToBottom()
    })
    for (const child of Array.from(el.children)) ro.observe(child)
    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of Array.from(m.addedNodes)) {
          if (node instanceof Element) ro.observe(node)
        }
      }
    })
    mo.observe(el, { childList: true })
    return () => {
      ro.disconnect()
      mo.disconnect()
    }
  }, [scrollToBottom])

  // Re-arm and snap to bottom when resetKey flips (e.g. session switch).
  // biome-ignore lint/correctness/useExhaustiveDependencies: scrollToBottom is stable
  useEffect(() => {
    autoRef.current = true
    scrollToBottom()
  }, [resetKey])

  // Deps-driven: still needed for the `pending` path (sending a message must
  // force the next render to land at the bottom regardless of prior state).
  // The ResizeObserver handles steady-state growth.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scrollToBottom is stable
  useEffect(() => {
    if (pendingRef.current) {
      pendingRef.current = false
      autoRef.current = true
      scrollToBottom()
    } else if (autoRef.current) {
      scrollToBottom()
    }
  }, deps)

  const markPendingScroll = useCallback(() => {
    pendingRef.current = true
  }, [])

  const handleScrollBtnClick = useCallback(() => {
    autoRef.current = true
    scrollToBottom()
  }, [scrollToBottom])

  return {
    scrollRef,
    showScrollBtn,
    scrollToBottom,
    markPendingScroll,
    handleScrollBtnClick,
  }
}
