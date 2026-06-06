import { SlotContainer } from '@/components/shell/SlotContainer'
import type { SlotConfig } from '@/contexts/SlotContext'
import { useResizablePanel } from '@/hooks/useResizablePanel'
import { GripVertical } from 'lucide-react'
import { useRef } from 'react'

/**
 * Three-slot layout. slot-a (sessions) and slot-c (chat) carry persisted
 * widths anchored to their respective edges; slot-b (the working area —
 * files / automation / settings) gets the leftover space and grows with
 * viewport. Default app placement matches the old sidebar story.
 */
export const THREE_COLUMN_SLOTS: SlotConfig[] = [
  { id: 'slot-a', defaultOpened: ['sessions'] },
  {
    id: 'slot-b',
    defaultOpened: ['files', 'browser', 'skills', 'terminal', 'automation', 'memory', 'settings'],
  },
  { id: 'slot-c', defaultOpened: ['chat'] },
]

/** Each side panel may shrink to this; middle keeps its own min via min-w-0. */
const SLOT_A_MIN = 240
const SLOT_C_MIN = 360
/** Middle slot is allowed to be squeezed to this before sides stop growing. */
const SLOT_B_MIN = 320
/** Inner flex framing: 4 gaps (gap-0.5 = 2px) + 2 handles (w-2 = 8px) = 24px. */
const FRAMING = 4 * 2 + 8 * 2

export function ThreeColumnLayout() {
  // Refs shadow latest sizes so each panel's `max` callback can read
  // sibling current width without re-creating the closure.
  const leftSizeRef = useRef(280)
  const rightSizeRef = useRef(420)

  const left = useResizablePanel({
    direction: 'left',
    min: SLOT_A_MIN,
    max: (container) =>
      Math.max(SLOT_A_MIN, container - rightSizeRef.current - SLOT_B_MIN - FRAMING),
    storageKey: 'tos-3col-left-width',
    defaultSize: 280,
  })
  const right = useResizablePanel({
    direction: 'right',
    min: SLOT_C_MIN,
    max: (container) =>
      Math.max(SLOT_C_MIN, container - leftSizeRef.current - SLOT_B_MIN - FRAMING),
    storageKey: 'tos-3col-right-width',
    defaultSize: 420,
  })

  leftSizeRef.current = left.size
  rightSizeRef.current = right.size

  // Both panels measure against the same container; share the DOM node.
  const setContainer = (el: HTMLDivElement | null) => {
    ;(left.containerRef as React.MutableRefObject<HTMLDivElement | null>).current = el
    ;(right.containerRef as React.MutableRefObject<HTMLDivElement | null>).current = el
  }

  return (
    <div className="h-full min-h-0 p-3">
      <div ref={setContainer} className="flex h-full min-h-0 gap-0.5">
        <div className="flex min-w-0 shrink-0" style={{ width: left.size }}>
          <SlotContainer slotId="slot-a" />
        </div>
        <ResizeHandle onMouseDown={left.onMouseDown} />
        <div className="flex min-w-0 flex-1">
          <SlotContainer slotId="slot-b" />
        </div>
        <ResizeHandle onMouseDown={right.onMouseDown} />
        <div className="flex min-w-0 shrink-0" style={{ width: right.size }}>
          <SlotContainer slotId="slot-c" />
        </div>
      </div>
    </div>
  )
}

function ResizeHandle({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <div
      className="group flex w-2 shrink-0 cursor-col-resize items-center justify-center rounded-full transition-colors hover:bg-foreground/[0.04]"
      onMouseDown={onMouseDown}
    >
      <GripVertical
        aria-hidden
        className="h-3.5 w-3.5 text-muted-foreground/30 transition-colors group-hover:text-muted-foreground/60"
      />
    </div>
  )
}
