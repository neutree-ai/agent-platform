import { useAppHeaderSlot } from '@/components/shell/windows/AppWindow'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { useInstancePersistentState } from '@/stores/instance-state-store'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

type RangeKey = '7d' | '30d' | '90d'

const RANGE_DAYS: Record<RangeKey, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
}

/**
 * The window picker the stat apps share, rendered into their window header.
 * The choice is persisted per app instance, so two apps side by side can look
 * at different windows and both survive a reload.
 */
export function useRangeControl(instanceId: string, stateKey: string) {
  const { t } = useTranslation()
  const headerSlot = useAppHeaderSlot()
  const [range, setRange] = useInstancePersistentState<RangeKey>(instanceId, stateKey, () => '30d')

  const control =
    headerSlot &&
    createPortal(
      <SegmentedControl<RangeKey>
        value={range}
        onValueChange={setRange}
        mode="tabs"
        ariaLabel={t('components.shell.statsRange.aria')}
        options={[
          { value: '7d', label: t('components.shell.statsRange.7d') },
          { value: '30d', label: t('components.shell.statsRange.30d') },
          { value: '90d', label: t('components.shell.statsRange.90d') },
        ]}
      />,
      headerSlot,
    )

  return { days: RANGE_DAYS[range], control }
}
