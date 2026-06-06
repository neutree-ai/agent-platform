import { cn } from '@/lib/utils'
import { useMemo, useState } from 'react'

interface PunchCardProps {
  /** Sparse buckets — only non-zero entries. dow: 0 (Sun) … 6 (Sat). */
  data: { dow: number; hour: number; count: number }[]
  i18n: {
    /** Tooltip text, e.g. "Tue · 14:00 · 7". */
    cellTooltip: (dow: number, hour: number, count: number) => string
    /** Suffix shown on each hour-axis tick, e.g. "h" or a localized equivalent. */
    hourSuffix: string
    /** Short weekday name for each day index 0..6 (Sun..Sat). Caller-supplied
     *  so it can match the rest of the app's locale (i18n keys vs. Intl). */
    dowShort: (dow: number) => string
  }
  className?: string
}

/**
 * Hour × weekday "punch card" grid — 7 rows × 24 columns. Color encodes
 * intensity (5 buckets, computed against the data's max so even small
 * absolute counts read with contrast). Answers the "when do I work"
 * question that a daily total can't.
 *
 * Grid stretches to fill its container width (cells become wider rectangles
 * as the card grows). Cursor-tracked floating tooltip on hover.
 */
export function PunchCard({ data, i18n, className }: PunchCardProps) {
  const { grid, max } = useMemo(() => {
    const grid = Array.from({ length: 7 }, () => new Array<number>(24).fill(0))
    let max = 0
    for (const b of data) {
      if (b.dow < 0 || b.dow > 6) continue
      if (b.hour < 0 || b.hour > 23) continue
      grid[b.dow][b.hour] = b.count
      if (b.count > max) max = b.count
    }
    return { grid, max }
  }, [data])

  const [hover, setHover] = useState<{ dow: number; hour: number; x: number; y: number } | null>(
    null,
  )

  // viewBox units; cells are 1 × 1 with a small gap.
  const cell = 1
  const gap = 0.12
  const colW = cell + gap
  const cols = 24
  const rows = 7
  const totalW = cols * colW - gap
  const totalH = rows * colW - gap

  const dowLabels = useMemo(() => Array.from({ length: 7 }, (_, i) => i18n.dowShort(i)), [i18n])

  function handleMove(e: React.PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const col = Math.min(cols - 1, Math.max(0, Math.floor((x / rect.width) * cols)))
    const row = Math.min(rows - 1, Math.max(0, Math.floor((y / rect.height) * rows)))
    setHover({ dow: row, hour: col, x, y })
  }

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex gap-1.5">
        {/* Weekday gutter */}
        <div className="flex flex-col justify-around py-[1px] text-[9px] font-medium text-muted-foreground/60">
          {dowLabels.map((d, i) => (
            <span key={i} className="leading-none">
              {d}
            </span>
          ))}
        </div>
        <div
          className="relative flex-1"
          onPointerMove={handleMove}
          onPointerLeave={() => setHover(null)}
        >
          <svg
            viewBox={`0 0 ${totalW} ${totalH}`}
            preserveAspectRatio="none"
            role="img"
            aria-label="hour-of-day activity"
            className="block w-full"
            style={{ aspectRatio: `${cols} / ${rows}` }}
          >
            {grid.map((row, r) =>
              row.map((count, c) => {
                const bucket = bucketize(count, max)
                const isHover = hover?.dow === r && hover?.hour === c
                return (
                  <rect
                    key={`${r}-${c}`}
                    x={c * colW}
                    y={r * colW}
                    width={cell}
                    height={cell}
                    rx={0.18}
                    className={cn(INTENSITY[bucket], isHover && 'stroke-foreground/40')}
                    strokeWidth={isHover ? 0.06 : 0}
                  />
                )
              }),
            )}
          </svg>
          {hover && (
            <div
              className={cn(
                'pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full',
                'whitespace-nowrap rounded-md border border-foreground/[0.08] bg-popover',
                'px-2 py-1 text-[11px] tabular-nums text-popover-foreground shadow-md',
              )}
              style={{ left: hover.x, top: hover.y - 4 }}
            >
              {i18n.cellTooltip(hover.dow, hover.hour, grid[hover.dow][hover.hour])}
            </div>
          )}
        </div>
      </div>
      {/* Hour scale: 0 / 6 / 12 / 18 / 24 anchored to true x-positions
          (0%, 25%, 50%, 75%, 100%) so they line up with the grid columns
          rather than evenly partitioning the row. */}
      <div className="flex gap-1.5">
        <div className="invisible text-[9px]" aria-hidden>
          {/* Reserves the same gutter width as the weekday column above
              so the axis aligns with the grid, not the wrapper. */}
          {dowLabels[0]}
        </div>
        <div className="relative h-3 flex-1 text-[9px] tabular-nums text-muted-foreground/60">
          {[0, 6, 12, 18, 24].map((h, i) => (
            <span
              key={h}
              className="absolute whitespace-nowrap leading-none"
              style={{
                left: `${(h / 24) * 100}%`,
                transform:
                  i === 0 ? 'translateX(0)' : i === 4 ? 'translateX(-100%)' : 'translateX(-50%)',
              }}
            >
              {h}
              {i18n.hourSuffix}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

const INTENSITY: Record<number, string> = {
  0: 'fill-foreground/[0.05]',
  1: 'fill-primary/25',
  2: 'fill-primary/45',
  3: 'fill-primary/65',
  4: 'fill-primary/85',
}

function bucketize(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (count === 0 || max === 0) return 0
  const ratio = count / max
  if (ratio <= 0.25) return 1
  if (ratio <= 0.5) return 2
  if (ratio <= 0.75) return 3
  return 4
}
