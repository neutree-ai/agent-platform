import { SplitBar } from '@/components/home/SplitBar'
import { formatTokenCount } from '@/lib/format-tokens'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'

export interface TokenComposition {
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
}

// Dense diagonal hatch in the current text color over a transparent track —
// marks the "cached" portions as a texture of the input colour rather than a
// third hue. Tight 4px period (2.5px stroke) so it reads as a solid weave, not
// sparse lines, even on a 2px-tall bar.
const HATCH =
  'bg-[repeating-linear-gradient(45deg,currentColor_0px,currentColor_2.5px,transparent_2.5px,transparent_4px)]'

/**
 * Token composition in three segments — input / cache / output — across two
 * clearly distinct hues: the input family (primary, cool) and output (warning,
 * warm), far enough apart in hue to never be confused while avoiding an alarming
 * red. Cache tokens (read + write) are input-side, so they share the input
 * colour and are set apart by a diagonal hatch rather than a third hue. Bar +
 * legend order is cache → input → output, keeping the input family (cached +
 * fresh) contiguous before output. Colours are design tokens only; the only
 * inline style is the segment width.
 */
const SEGMENTS = [
  {
    key: 'cache',
    tone: 'text-primary',
    bg: '',
    hatch: true,
    value: (c: TokenComposition) => c.cacheRead + c.cacheCreation,
  },
  {
    key: 'input',
    tone: 'text-primary',
    bg: 'bg-primary',
    hatch: false,
    value: (c: TokenComposition) => c.input,
  },
  {
    key: 'output',
    tone: 'text-warning',
    bg: 'bg-warning',
    hatch: false,
    value: (c: TokenComposition) => c.output,
  },
] as const

export function TokenCompositionBar({ composition }: { composition: TokenComposition }) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-3">
      <SplitBar
        segments={SEGMENTS.map((s) => ({
          key: s.key,
          className: s.hatch ? cn(s.tone, HATCH) : s.bg,
          value: s.value(composition),
        }))}
      />
      <div className="grid grid-cols-3 gap-x-4 gap-y-1.5">
        {SEGMENTS.map((s) => (
          <div key={s.key} className="flex items-center gap-1.5 text-[11px]">
            <span
              className={cn('h-2 w-2 shrink-0 rounded-[2px]', s.hatch ? cn(s.tone, HATCH) : s.bg)}
            />
            <span className="text-muted-foreground/80">
              {t(`components.shell.tokenUsage.${s.key}`)}
            </span>
            <span className="ml-auto tabular-nums text-foreground/80">
              {formatTokenCount(s.value(composition))}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
