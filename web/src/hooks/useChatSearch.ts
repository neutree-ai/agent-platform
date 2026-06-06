import { searchMessages } from '@/lib/search-utils'
import type { ChatMessage } from '@/stores/agent-session-store'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const HIGHLIGHT_NAME = 'chat-search'
const HIGHLIGHT_ACTIVE = 'chat-search-active'

/** Whether the browser supports the CSS Custom Highlight API. */
const supportsHighlightAPI = typeof globalThis.Highlight === 'function' && CSS.highlights != null

/**
 * Find all Range objects matching `query` inside `container` (read-only DOM traversal).
 */
function findTextRanges(container: HTMLElement, query: string): Range[] {
  const q = query.toLowerCase()
  const ranges: Range[] = []
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    const text = node.nodeValue?.toLowerCase() ?? ''
    let idx = text.indexOf(q)
    while (idx !== -1) {
      const range = new Range()
      range.setStart(node, idx)
      range.setEnd(node, idx + q.length)
      ranges.push(range)
      idx = text.indexOf(q, idx + q.length)
    }
  }
  return ranges
}

export function useChatSearch(
  scrollContainerRef: React.RefObject<HTMLDivElement | null>,
  /**
   * Root element that scopes the cmd+F shortcut. Keydown is attached here
   * (not `window`) so the shortcut only fires when focus is inside the
   * chat panel — file/terminal/other panels in adjacent slots get the
   * browser-native Find behavior. See forum thread o5z1wo9f.
   */
  panelRef: React.RefObject<HTMLDivElement | null>,
  messages: ChatMessage[],
) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchIndex, setSearchIndex] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const rangesRef = useRef<Range[]>([])

  // Pure data-level match count (for display and bounds)
  const searchMatches = useMemo(
    () => searchMessages(messages, searchQuery),
    [messages, searchQuery],
  )

  // Apply CSS highlights (read-only DOM traversal, no mutation)
  useEffect(() => {
    if (!supportsHighlightAPI) return
    CSS.highlights.delete(HIGHLIGHT_NAME)
    CSS.highlights.delete(HIGHLIGHT_ACTIVE)

    const container = scrollContainerRef.current
    if (!container || !searchQuery.trim()) {
      rangesRef.current = []
      return
    }

    const ranges = findTextRanges(container, searchQuery)
    rangesRef.current = ranges

    if (ranges.length > 0) {
      CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges))
    }

    return () => {
      CSS.highlights.delete(HIGHLIGHT_NAME)
      CSS.highlights.delete(HIGHLIGHT_ACTIVE)
    }
  }, [searchQuery, messages, scrollContainerRef])

  // Reset index when query or matches change
  useEffect(() => {
    setSearchIndex(0)
    if (rangesRef.current.length > 0 && supportsHighlightAPI) {
      CSS.highlights.delete(HIGHLIGHT_ACTIVE)
      CSS.highlights.set(HIGHLIGHT_ACTIVE, new Highlight(rangesRef.current[0]))
      rangesRef.current[0].startContainer.parentElement?.scrollIntoView({
        block: 'center',
        behavior: 'smooth',
      })
    }
  }, [searchQuery, messages])

  const navigateSearch = useCallback((direction: 'prev' | 'next') => {
    const ranges = rangesRef.current
    if (ranges.length === 0) return

    setSearchIndex((prev) => {
      const nextIdx =
        direction === 'next'
          ? (prev + 1) % ranges.length
          : (prev - 1 + ranges.length) % ranges.length

      if (supportsHighlightAPI) {
        CSS.highlights.delete(HIGHLIGHT_ACTIVE)
        CSS.highlights.set(HIGHLIGHT_ACTIVE, new Highlight(ranges[nextIdx]))
      }
      ranges[nextIdx].startContainer.parentElement?.scrollIntoView({
        block: 'center',
        behavior: 'smooth',
      })

      return nextIdx
    })
  }, [])

  // Track whether the chat panel owns the user's attention. Plain div clicks
  // don't move focus (divs aren't focusable), so we can't gate cmd+F on
  // `document.activeElement`. Instead a capture-phase pointerdown listener
  // records "was the last click inside the chat panel?" — true → cmd+F
  // intercepts; false → fall through to browser-native Find so other
  // panels (files, terminal) work as expected. See forum thread o5z1wo9f.
  const wasLastClickInChatRef = useRef(false)
  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      wasLastClickInChatRef.current = panelRef.current?.contains(e.target as Node) ?? false
    }
    window.addEventListener('pointerdown', handlePointerDown, true)
    return () => window.removeEventListener('pointerdown', handlePointerDown, true)
  }, [panelRef])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        if (!wasLastClickInChatRef.current) return
        if ((e.target as HTMLElement)?.closest('input, textarea, [contenteditable]')) return
        e.preventDefault()
        setSearchOpen(true)
        setTimeout(() => searchInputRef.current?.focus(), 0)
      }
      if (e.key === 'Escape' && searchOpen) {
        setSearchOpen(false)
        setSearchQuery('')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [searchOpen])

  return {
    searchOpen,
    setSearchOpen,
    searchQuery,
    setSearchQuery,
    searchMatches,
    searchIndex,
    searchInputRef,
    navigateSearch,
  }
}
