import { cn } from '@/lib/utils'
import { Globe, Lock, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export type ResourceScope = 'private' | 'team' | 'public'

const SCOPE_META: Record<ResourceScope, { Icon: typeof Lock; tone: string; labelKey: string }> = {
  private: {
    Icon: Lock,
    tone: 'text-muted-foreground/80',
    labelKey: 'components.resource.scope.private',
  },
  team: {
    Icon: Users,
    tone: 'text-info/80',
    labelKey: 'components.resource.scope.team',
  },
  public: {
    Icon: Globe,
    tone: 'text-success/80',
    labelKey: 'components.resource.scope.public',
  },
}

interface ScopeBadgeProps {
  scope: ResourceScope
  /** Icon-only mode (uses `title` for tooltip). */
  compact?: boolean
  className?: string
}

/**
 * Visual token for a resource's access scope. Used on every resource card so
 * scope is readable at a glance without separate sections per scope. Icons
 * carry the meaning, color is a low-saturation accent so the badge doesn't
 * compete with the resource's own content.
 */
export function ScopeBadge({ scope, compact, className }: ScopeBadgeProps) {
  const { t } = useTranslation()
  const { Icon, tone, labelKey } = SCOPE_META[scope]
  const label = t(labelKey)
  if (compact) {
    return (
      <span
        title={label}
        aria-label={label}
        className={cn('inline-flex items-center', tone, className)}
      >
        <Icon className="h-3 w-3" strokeWidth={2} />
      </span>
    )
  }
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs', tone, className)}>
      <Icon className="h-3 w-3" strokeWidth={2} />
      {label}
    </span>
  )
}
