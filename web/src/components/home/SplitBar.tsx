import { cn } from '@/lib/utils'

interface SplitBarSegment {
  key: string
  /** Colour/texture classes for this segment — tokens only, no literal hues. */
  className: string
  value: number
}

/**
 * A proportion bar: one track, one segment per part, widths from the values.
 * The width is the only inline style; everything else is a class so segments
 * can carry a texture (a hatch) as easily as a fill.
 */
export function SplitBar({ segments }: { segments: SplitBarSegment[] }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0)
  return (
    <div className="flex h-2 gap-[2px] overflow-hidden rounded-full bg-foreground/[0.05]">
      {segments.map((s) => {
        const pct = total > 0 ? (s.value / total) * 100 : 0
        return (
          pct > 0 && (
            <div key={s.key} className={cn('h-full', s.className)} style={{ width: `${pct}%` }} />
          )
        )
      })}
    </div>
  )
}
