import { SlotEmptyState } from '@/components/shell/SlotEmptyState'
import { AppWindow } from '@/components/shell/windows/AppWindow'
import { useRequiredSlotContext } from '@/contexts/SlotContext'

interface SlotContainerProps {
  slotId: string
}

/**
 * Renders whichever app is currently active in this slot, wrapped in an
 * AppWindow. Falls back to SlotEmptyState when nothing is opened.
 *
 * Each opened-but-inactive app is NOT mounted here — switching active is
 * a remount. Apps that need to preserve cross-switch state (e.g., chat
 * sessions) rely on context providers rendered higher up the tree.
 */
export function SlotContainer({ slotId }: SlotContainerProps) {
  const ctx = useRequiredSlotContext()
  const state = ctx.getState(slotId)

  const instance = state.active
  if (!instance) {
    return <SlotEmptyState slotId={slotId} />
  }

  const app = ctx.getApp(instance.appId)
  if (!app) {
    return <SlotEmptyState slotId={slotId} />
  }

  const App = app.Component
  const isFilled = ctx.filledSlot === slotId

  function handleFill() {
    ctx.setFilledSlot(isFilled ? null : slotId)
  }

  // Keying on instance.id ensures that activating a different instance of
  // the same app remounts the component (each instance has its own state
  // scope). Switching between instances of different apps remounts trivially.
  return (
    <AppWindow
      onClose={() => ctx.close(slotId, instance.id)}
      onPopOut={() => ctx.popOut(slotId, instance.id)}
      onFill={handleFill}
      isFilled={isFilled}
    >
      <App key={instance.id} instanceId={instance.id} />
    </AppWindow>
  )
}
