import { type ResourceScope, ScopeBadge } from '@/components/resource/ScopeBadge'
import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

interface ResourceCardProps {
  /** Primary heading — usually the resource name. */
  name: ReactNode
  /** Optional 1–2 line description. Auto-clamped at 2 lines. */
  description?: ReactNode
  /** Resource type or short kind label (e.g., "anthropic-oauth"). */
  type?: ReactNode
  /** Optional kind icon shown next to `type`. */
  typeIcon?: LucideIcon
  /** Free meta line (e.g., URL). Truncated to one line. */
  meta?: ReactNode
  /**
   * Free-form slot rendered between description and footer. Use sparingly
   * — only for resources that need an inline affordance the standard
   * name/description/meta shape can't carry (e.g., a route's webhook URL
   * pill or reveal-once secret). Footer remains for type/scope/owned.
   */
  body?: ReactNode
  /**
   * Access scope for resources that have one (private / team / public).
   * Omit for resources that are scope-less (e.g., credentials are always
   * user-private and don't need a chip).
   */
  scope?: ResourceScope
  /**
   * True when the current user owns this resource. Surfaces a "yours" tag
   * in the meta row so ownership is readable without hovering. Only
   * meaningful when the resource has a scope concept (otherwise everything
   * the user sees is theirs).
   */
  owned?: boolean
  /**
   * Hover-revealed actions, top-right of the card. Caller composes Buttons
   * — keep them small (h-6 w-6 icon) for visual density.
   */
  actions?: ReactNode
  /** Click anywhere on the card surface (excluding actions). */
  onClick?: () => void
  className?: string
}

/**
 * Unified resource card used by every grid-of-resources app (providers,
 * connectors, oauth-apps, credentials, prompts, skills, templates, ...).
 *
 * Visual layout (top → bottom):
 *   ┌─ name ─────────────── [actions on hover] ─┐
 *   │ description (clamp 2)                       │
 *   │                                              │
 *   │ [typeIcon] type · meta            scope    │
 *   └─────────────────────────────────────────────┘
 *
 * For list view, each section renders `ResourceListItem` directly
 * instead — the list primitive has its own slot shape so each section
 * can prioritize the columns that matter for that resource kind,
 * rather than being compressed into the card's schema.
 */
export function ResourceCard({
  name,
  description,
  type,
  typeIcon: TypeIcon,
  meta,
  body,
  scope,
  owned,
  actions,
  onClick,
  className,
}: ResourceCardProps) {
  const { t } = useTranslation()
  const interactive = Boolean(onClick)
  const nameTitle = typeof name === 'string' ? name : undefined
  const descTitle = typeof description === 'string' ? description : undefined
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
        'group/card relative flex h-full min-h-[8.5rem] flex-col gap-2 rounded-xl p-5',
        // Elevation overlay on top of the AppWindow's bg-card surface — a
        // subtle theme-aware tint reads as a raised card without a border.
        'bg-foreground/[0.04]',
        'transition-colors duration-150',
        interactive &&
          'cursor-pointer hover:bg-foreground/[0.06] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 truncate text-sm font-medium" title={nameTitle}>
          {name}
        </div>
        {actions && (
          <div
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            className={cn(
              'flex shrink-0 items-center gap-0.5',
              'opacity-0 transition-opacity duration-150',
              'group-hover/card:opacity-100 focus-within:opacity-100',
            )}
          >
            {actions}
          </div>
        )}
      </div>

      {description && (
        <div
          className="line-clamp-2 text-xs leading-relaxed text-muted-foreground"
          title={descTitle}
        >
          {description}
        </div>
      )}

      {body && <div className="min-w-0">{body}</div>}

      <div className="mt-auto flex items-center justify-between gap-2 pt-1 text-xs text-muted-foreground/70">
        <div className="flex min-w-0 items-center gap-1.5">
          {TypeIcon && <TypeIcon className="h-3 w-3 shrink-0" strokeWidth={2} />}
          {type && <span className="shrink-0">{type}</span>}
          {type && meta && <span aria-hidden>·</span>}
          {meta && <span className="truncate">{meta}</span>}
        </div>
        {(owned || scope) && (
          <div className="flex shrink-0 items-center gap-1.5">
            {owned && (
              <span className="font-medium text-primary">
                {t('components.resource.ownership.yours')}
              </span>
            )}
            {scope && <ScopeBadge scope={scope} />}
          </div>
        )}
      </div>
    </div>
  )
}
