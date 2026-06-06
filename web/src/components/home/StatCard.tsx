import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'
import { useState } from 'react'

export interface SparklinePoint {
  value: number
  /** Tooltip text shown on hover (e.g. "May 3 · 12"). */
  tooltip?: string
}

interface StatCardProps {
  label: string
  value: string | number
  /** Optional series for an inline sparkline. Each point may carry its own
   *  tooltip text — caller crafts it (date + value, etc.). */
  sparkline?: SparklinePoint[]
  /** Optional leading icon next to the label. */
  icon?: LucideIcon
  className?: string
}

/**
 * Compact stat tile used by Stats. Establishes the platform's
 * stat-card visual language — small label on top, large value, inline
 * sparkline. Future stat surfaces (cost, success rate, cluster) compose
 * visually without re-design.
 */
export function StatCard({ label, value, sparkline, icon: Icon, className }: StatCardProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-lg border border-foreground/[0.06] bg-card/40 p-5',
        className,
      )}
    >
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
        {Icon && <Icon className="h-3 w-3" strokeWidth={2} />}
        <span>{label}</span>
      </div>
      <div className="flex items-end gap-4">
        <span className="text-4xl font-semibold tabular-nums leading-none text-foreground">
          {value}
        </span>
        {sparkline && sparkline.length > 1 && (
          <div className="min-w-0 flex-1">
            <Sparkline data={sparkline} />
          </div>
        )}
      </div>
    </div>
  )
}

export function Sparkline({ data }: { data: SparklinePoint[] }) {
  const N = data.length
  const cellUnit = 4
  const gap = 1
  const totalW = N * (cellUnit + gap) - gap
  const totalH = 36
  const max = Math.max(...data.map((d) => d.value), 1)

  // Cursor-tracked tooltip — native SVG `<title>` is unreliable in some
  // browsers (delayed / suppressed in busy SPAs). A single floating div
  // tracked by mousemove gives consistent feedback across Chrome/Safari.
  const [hover, setHover] = useState<{ idx: number; x: number } | null>(null)

  function handleMove(e: React.PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const idx = Math.min(N - 1, Math.max(0, Math.floor((x / rect.width) * N)))
    setHover({ idx, x })
  }

  return (
    <div className="relative" onPointerMove={handleMove} onPointerLeave={() => setHover(null)}>
      <svg
        viewBox={`0 0 ${totalW} ${totalH}`}
        preserveAspectRatio="none"
        className="block w-full text-primary/50"
        style={{ height: totalH }}
        role="img"
        aria-label="sparkline"
      >
        {data.map((d, i) => {
          const barH = Math.max(1, (d.value / max) * (totalH - 2))
          const isHover = hover?.idx === i
          return (
            <rect
              key={i}
              x={i * (cellUnit + gap)}
              y={totalH - barH}
              width={cellUnit}
              height={barH}
              rx={0.5}
              fill="currentColor"
              className={cn(isHover && 'text-primary')}
            />
          )
        })}
      </svg>
      {hover && data[hover.idx]?.tooltip && (
        <div
          className={cn(
            'pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full',
            'whitespace-nowrap rounded-md border border-foreground/[0.08] bg-popover',
            'px-2 py-1 text-[11px] tabular-nums text-popover-foreground shadow-md',
          )}
          style={{ left: hover.x, top: -4 }}
        >
          {data[hover.idx].tooltip}
        </div>
      )}
    </div>
  )
}
