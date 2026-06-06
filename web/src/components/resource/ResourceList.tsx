import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

interface ResourceListProps {
  children: ReactNode
  className?: string
}

/**
 * Vertical stack container for `ResourceListItem`s. The list-view
 * sibling of `ResourceGrid` — each section picks one or the other
 * based on the active view mode and renders the right primitive
 * inside.
 */
export function ResourceList({ children, className }: ResourceListProps) {
  return <div className={cn('flex flex-col gap-1', className)}>{children}</div>
}
