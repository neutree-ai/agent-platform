import { SlotContainer } from '@/components/shell/SlotContainer'
import type { SlotConfig } from '@/contexts/SlotContext'
import { useResizablePanel } from '@/hooks/useResizablePanel'
import { GripVertical } from 'lucide-react'

/**
 * Slot identity / defaults are properties of the layout. Each layout
 * exports its own SLOTS constant; the registry wires them up.
 */
export const TWO_COLUMN_SLOTS: SlotConfig[] = [
  {
    id: 'slot-a',
    defaultOpened: ['files', 'browser', 'skills', 'terminal', 'automation', 'memory', 'settings'],
  },
  { id: 'slot-b', defaultOpened: ['chat'] },
]

/** Reserved width for slot-a — drag of slot-b stops once slot-a hits this. */
const SLOT_A_MIN = 320
/** Inner flex framing: 2 gaps (gap-0.5 = 2px each) + 1 handle (w-2 = 8px). */
const FRAMING = 2 * 2 + 8

/**
 * Two-slot layout — slot-a flexes; slot-b has a persisted, drag-resizable
 * width anchored to the right edge.
 */
export function TwoColumnLayoutDefault() {
  const {
    containerRef,
    size: rightWidth,
    onMouseDown,
  } = useResizablePanel({
    direction: 'right',
    min: 320,
    max: (container) => Math.max(0, container - SLOT_A_MIN - FRAMING),
    storageKey: 'tos-2col-right-width',
    defaultSize: 480,
  })

  return (
    <div className="h-full min-h-0 p-3">
      <div ref={containerRef} className="flex h-full min-h-0 gap-0.5">
        <div className="flex min-w-0 flex-1">
          <SlotContainer slotId="slot-a" />
        </div>
        <div
          className="group flex w-2 shrink-0 cursor-col-resize items-center justify-center rounded-full transition-colors hover:bg-foreground/[0.04]"
          onMouseDown={onMouseDown}
        >
          <GripVertical
            aria-hidden
            className="h-3.5 w-3.5 text-muted-foreground/30 transition-colors group-hover:text-muted-foreground/60"
          />
        </div>
        <div className="flex min-w-0 shrink-0" style={{ width: rightWidth }}>
          <SlotContainer slotId="slot-b" />
        </div>
      </div>
    </div>
  )
}
