import { Sparkline, type SparklinePoint } from '@/components/home/StatCard'
import { type TokenComposition, TokenCompositionBar } from '@/components/home/TokenCompositionBar'
import { formatTokenCount } from '@/lib/format-tokens'
import { useTranslation } from 'react-i18next'

interface TokenUsageCardProps {
  /** All-in total (input+output+cache) for the period — the headline number. */
  total: number
  /** Daily all-in series for the inline sparkline. */
  sparkline: SparklinePoint[]
  composition: TokenComposition
}

/**
 * Headline token card for the Stats app: the period's all-in token total with a
 * daily sparkline, and below a divider the composition bar that reveals how much
 * of that volume is (cheap) cache-read vs real input/output. Shares the stat-card
 * shell with StatCard so it sits in the same visual language.
 */
export function TokenUsageCard({ total, sparkline, composition }: TokenUsageCardProps) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-foreground/[0.06] bg-card/40 p-5">
      <div className="flex flex-col gap-3">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
          {t('components.shell.activityApp.token.usageLabel')}
        </div>
        <div className="flex items-end gap-4">
          <span className="text-4xl font-semibold tabular-nums leading-none text-foreground">
            {formatTokenCount(total)}
          </span>
          {sparkline.length > 1 && (
            <div className="min-w-0 flex-1">
              <Sparkline data={sparkline} />
            </div>
          )}
        </div>
      </div>
      <div className="border-foreground/[0.06] border-t pt-4">
        <div className="mb-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
          {t('components.shell.activityApp.token.compositionLabel')}
        </div>
        <TokenCompositionBar composition={composition} />
      </div>
    </div>
  )
}
