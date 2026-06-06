import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

interface ResourceGridProps {
  children: ReactNode
  className?: string
}

/**
 * Standard responsive grid for `ResourceCard`s. Single source of truth
 * for card column count and gutter so every resource app reads at the
 * same rhythm. List view is a separate component — see `ResourceList`.
 */
export function ResourceGrid({ children, className }: ResourceGridProps) {
  return (
    <div className="@container">
      <div
        className={cn('grid gap-3 @lg:grid-cols-2 @3xl:grid-cols-3 @5xl:grid-cols-4', className)}
      >
        {children}
      </div>
    </div>
  )
}
