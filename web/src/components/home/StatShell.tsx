import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

interface StatShellProps {
  label: ReactNode
  /** Optional right-aligned figure on the label row (a total, a count). */
  aside?: ReactNode
  /** Optional line under the label, for a caption the label can't carry. */
  caption?: ReactNode
  children: ReactNode
  className?: string
}

/**
 * The card every stat surface sits in. Owns the border/background/padding so
 * the Stats and Resources apps stay one visual language, and adding a card
 * doesn't mean re-typing the class string.
 */
export function StatShell({ label, aside, caption, children, className }: StatShellProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-lg border border-foreground/[0.06] bg-card/40 p-5',
        className,
      )}
    >
      <div className="flex flex-col gap-0.5">
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
            {label}
          </div>
          {aside && (
            <div className="shrink-0 text-[11px] tabular-nums text-muted-foreground/60">
              {aside}
            </div>
          )}
        </div>
        {caption && <div className="text-[11px] text-muted-foreground/60">{caption}</div>}
      </div>
      {children}
    </div>
  )
}
