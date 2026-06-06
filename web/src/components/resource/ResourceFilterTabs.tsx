import type { ResourceScope } from '@/components/resource/ScopeBadge'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { cn } from '@/lib/utils'
import { Globe, Lock, type LucideIcon, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export type ScopeFilter = 'all' | ResourceScope

const TABS: { value: ScopeFilter; labelKey: string; Icon?: LucideIcon }[] = [
  { value: 'all', labelKey: 'components.resource.filter.all' },
  { value: 'private', labelKey: 'components.resource.filter.private', Icon: Lock },
  { value: 'team', labelKey: 'components.resource.filter.team', Icon: Users },
  { value: 'public', labelKey: 'components.resource.filter.public', Icon: Globe },
]

interface ResourceFilterTabsProps {
  value: ScopeFilter
  onValueChange: (next: ScopeFilter) => void
  /** Per-bucket counts displayed beside each tab label. Optional. */
  counts?: Partial<Record<ScopeFilter, number>>
  className?: string
}

/**
 * Scope filter for resource grids. Thin wrapper over `SegmentedControl`
 * that locks in the four scope tabs (all / private / team / public) so
 * every grid app stays visually consistent.
 */
export function ResourceFilterTabs({
  value,
  onValueChange,
  counts,
  className,
}: ResourceFilterTabsProps) {
  const { t } = useTranslation()
  return (
    <div
      className={cn(
        'min-w-0 max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
      )}
    >
      <SegmentedControl
        value={value}
        onValueChange={onValueChange}
        mode="tabs"
        ariaLabel={t('components.resource.filter.all')}
        options={TABS.map(({ value: v, labelKey, Icon }) => ({
          value: v,
          label: t(labelKey),
          icon: Icon,
          count: counts?.[v],
        }))}
        className={className}
      />
    </div>
  )
}
