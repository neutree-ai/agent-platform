import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

interface ResourceListItemProps {
  /**
   * Primary identifier — usually the resource name. Rendered as the
   * top-line bold text. Pass a string when possible so the row can
   * surface a native title tooltip for truncation overflow.
   */
  title: ReactNode
  /**
   * Optional title tooltip text. Defaults to `title` when it's a
   * string. Set explicitly when `title` is JSX but you still want a
   * tooltip (e.g., name plus a badge).
   */
  titleTooltip?: string
  /**
   * Secondary line under the title (e.g., description). One line,
   * truncated. Native tooltip surfaces the full text on hover.
   */
  subtitle?: ReactNode
  /** Optional subtitle tooltip. Defaults to `subtitle` when string. */
  subtitleTooltip?: string
  /**
   * Right-aligned slot for compact metadata badges, chips, or labels
   * (scope, "yours", kind icon, author). Caller composes — keep
   * elements small. Vertically centered on the top line.
   */
  trailing?: ReactNode
  /**
   * Hover-revealed action buttons, anchored to the far right of the
   * top line. Overlays the `trailing` column on hover via an absolute
   * positioned strip with a matching backdrop, so the resting row has
   * no empty gap reserved for invisible actions.
   */
  actions?: ReactNode
  /** Click anywhere on the row (excluding actions). */
  onClick?: () => void
  className?: string
}

/**
 * Slot-based row primitive for list views. Sections compose their own
 * row by deciding which fields belong in `title`/`subtitle`/`trailing`
 * — unlike `ResourceCard`, this primitive does not assume a
 * `name/description/type/meta/scope` shape, so each section's list
 * mode can prioritize the columns that actually matter for that
 * resource kind.
 *
 * Layout:
 *   ┌─ title ─────────────────── trailing | [actions on hover] ─┐
 *   │ subtitle (single line, truncated)                          │
 *   └─────────────────────────────────────────────────────────────┘
 */
export function ResourceListItem({
  title,
  titleTooltip,
  subtitle,
  subtitleTooltip,
  trailing,
  actions,
  onClick,
  className,
}: ResourceListItemProps) {
  const interactive = Boolean(onClick)
  const titleStr = titleTooltip ?? (typeof title === 'string' ? title : undefined)
  const subtitleStr = subtitleTooltip ?? (typeof subtitle === 'string' ? subtitle : undefined)
  return (
    <div
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick?.()
              }
            }
          : undefined
      }
      className={cn(
        'group/row relative flex flex-col gap-0.5 rounded-lg px-3 py-2',
        'bg-foreground/[0.03] hover:bg-foreground/[0.06]',
        'transition-colors duration-150',
        interactive &&
          'cursor-pointer focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25',
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1 truncate text-sm font-medium" title={titleStr}>
          {title}
        </div>
        {trailing && (
          <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground/80">
            {trailing}
          </div>
        )}
        {actions && (
          <div
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            className={cn(
              'absolute right-2 top-1.5 flex items-center gap-0.5 rounded-md',
              'pl-6 bg-gradient-to-l from-card from-45% to-transparent',
              'opacity-0 transition-opacity duration-150',
              'pointer-events-none group-hover/row:pointer-events-auto group-hover/row:opacity-100',
              'focus-within:pointer-events-auto focus-within:opacity-100',
            )}
          >
            {actions}
          </div>
        )}
      </div>
      {subtitle && (
        <div className="truncate text-xs text-muted-foreground" title={subtitleStr}>
          {subtitle}
        </div>
      )}
    </div>
  )
}
