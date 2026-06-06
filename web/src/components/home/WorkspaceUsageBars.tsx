import { formatTokenCount } from '@/lib/format-tokens'

interface WorkspaceUsageItem {
  workspaceId: string
  name: string
  tokens: number
}

/**
 * Per-workspace token breakdown — the ledger and the future quota unit are both
 * per-workspace, so this answers "which agent burned my budget". Bars are scaled
 * to the top consumer; the data-driven width is the only inline style (mirrors
 * the sparkline), colour is a token.
 */
export function WorkspaceUsageBars({ items }: { items: WorkspaceUsageItem[] }) {
  const max = Math.max(...items.map((i) => i.tokens), 1)
  return (
    <div className="flex flex-col gap-2.5">
      {items.map((it) => (
        <div key={it.workspaceId} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2 text-[12px]">
            <span className="truncate text-foreground/80">{it.name}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground/70">
              {formatTokenCount(it.tokens)}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-foreground/[0.05]">
            <div
              className="h-full rounded-full bg-primary/60"
              style={{ width: `${(it.tokens / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}
