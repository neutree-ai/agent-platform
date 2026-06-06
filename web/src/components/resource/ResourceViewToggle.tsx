import { SegmentedControl } from '@/components/ui/segmented-control'
import { LayoutGrid, List } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export type ResourceView = 'card' | 'list'

interface ResourceViewToggleProps {
  value: ResourceView
  onValueChange: (next: ResourceView) => void
  className?: string
}

/**
 * Card ↔ list view switch for resource grids. Thin wrapper over
 * `SegmentedControl` so every grid app stays visually consistent and
 * accessible.
 */
export function ResourceViewToggle({ value, onValueChange, className }: ResourceViewToggleProps) {
  const { t } = useTranslation()
  return (
    <SegmentedControl
      value={value}
      onValueChange={onValueChange}
      mode="tabs"
      ariaLabel={t('components.resource.view.card')}
      options={[
        {
          value: 'card',
          label: t('components.resource.view.card'),
          icon: LayoutGrid,
          iconOnly: true,
        },
        {
          value: 'list',
          label: t('components.resource.view.list'),
          icon: List,
          iconOnly: true,
        },
      ]}
      className={className}
    />
  )
}
