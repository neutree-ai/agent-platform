import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'
import { type ButtonHTMLAttributes, forwardRef } from 'react'

interface AppHeaderButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'tone'> {
  /** Optional leading icon. Icon-only mode when `label` is absent. */
  icon?: LucideIcon
  /** Text label. When omitted, button is rendered icon-only (square h-7 w-7). */
  label?: string
  /** Visual tone for hover/text. */
  tone?: 'default' | 'destructive' | 'primary'
}

/**
 * Standard action button for AppWindow headers. Two modes:
 *   - text+icon: pass both `icon` and `label` — used for primary actions.
 *   - icon-only: pass only `icon` — used for menu triggers / secondary actions.
 *
 * Always renders a plain `<button>` so it composes cleanly with Radix
 * triggers via `asChild` (forwardRef passes through onClick / data-state /
 * aria-expanded etc.). Use `title` attribute for tooltips on icon-only mode.
 */
export const AppHeaderButton = forwardRef<HTMLButtonElement, AppHeaderButtonProps>(
  function AppHeaderButton(
    { icon: Icon, label, tone = 'default', className, type = 'button', children, ...rest },
    ref,
  ) {
    const iconOnly = !label
    return (
      <button
        ref={ref}
        type={type}
        {...rest}
        className={cn(
          'flex h-7 shrink-0 items-center rounded-md transition-colors',
          'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25',
          'disabled:pointer-events-none disabled:opacity-40',
          iconOnly ? 'w-7 justify-center' : 'gap-1.5 px-2 text-xs font-normal',
          tone === 'destructive'
            ? 'text-muted-foreground/80 hover:bg-destructive/15 hover:text-destructive'
            : tone === 'primary'
              ? 'bg-primary text-primary-foreground font-medium hover:bg-primary/90'
              : 'text-muted-foreground/80 hover:bg-foreground/[0.06] hover:text-foreground data-[state=open]:bg-foreground/[0.06] data-[state=open]:text-foreground',
          className,
        )}
      >
        {Icon && <Icon className="h-3.5 w-3.5" strokeWidth={2} />}
        {label}
        {children}
      </button>
    )
  },
)
