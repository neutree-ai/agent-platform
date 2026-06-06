import { SlotContainer } from '@/components/shell/SlotContainer'
import { FLEET_DEFAULT_LAYOUT, FLEET_LAYOUT_IDS, LAYOUTS } from '@/components/shell/layout/layouts'
import { useSlotContext } from '@/contexts/SlotContext'
import { useActiveLayout } from '@/hooks/useActiveLayout'
import { FLEET_PROFILE_ID } from '@/stores/fleet-profile'

export function FleetPage() {
  const slotCtx = useSlotContext()
  const { layoutId } = useActiveLayout(FLEET_PROFILE_ID, {
    allowed: FLEET_LAYOUT_IDS,
    defaultId: FLEET_DEFAULT_LAYOUT,
  })
  // Desktop withholds SlotProvider until the fleet profile has been loaded
  // (server-backed; instant after first paint), so this is a tiny window
  // during first paint.
  if (!slotCtx) return null
  const filledSlot = slotCtx.filledSlot
  if (filledSlot) {
    return (
      <div className="flex h-full min-h-0 p-3">
        <SlotContainer slotId={filledSlot} />
      </div>
    )
  }
  // Fleet uses the same layout primitives as ws scope; slot defaults differ
  // and live in `FLEET_SLOTS_*COL` in Desktop.tsx.
  const ActiveLayout = LAYOUTS[layoutId].Component
  return <ActiveLayout />
}
