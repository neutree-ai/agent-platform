import { SlotPicker } from '@/components/shell/SlotPicker'
import { LayoutGrid } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface SlotEmptyStateProps {
  slotId: string
}

/**
 * Rendered inside a slot whose `opened` list is empty. The compact center
 * button is the picker trigger — popover anchors there so it visually
 * lands near the center of the slot, not in the dock or the menubar.
 */
export function SlotEmptyState({ slotId }: SlotEmptyStateProps) {
  const { t } = useTranslation()
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 items-center justify-center">
      <SlotPicker slotId={slotId} side="bottom" align="center">
        <button
          type="button"
          className="group flex flex-col items-center gap-2 rounded-lg px-6 py-4 text-muted-foreground/60 transition-colors duration-200 hover:bg-foreground/[0.03] hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25"
        >
          <LayoutGrid className="h-6 w-6 opacity-50 transition-opacity duration-200 group-hover:opacity-80" />
          <p className="text-xs">{t('components.shell.slot.emptyHint')}</p>
        </button>
      </SlotPicker>
    </div>
  )
}
