interface WorkspaceUsageItem {
  workspaceId: string
  name: string
  value: number
}

interface WorkspaceUsageBarsProps {
  items: WorkspaceUsageItem[]
  /** Renders a bar's value — tokens and core-hours read nothing alike. */
  format: (value: number) => string
  /** When given, each bar becomes the way into that workspace. */
  onSelect?: (item: WorkspaceUsageItem) => void
}

/**
 * Per-workspace breakdown of a single measure — the ledger and the future quota
 * unit are both per-workspace, so this answers "which agent burned my budget".
 * Bars are scaled to the top consumer; the data-driven width is the only inline
 * style (mirrors the sparkline), colour is a token.
 */
export function WorkspaceUsageBars({ items, format, onSelect }: WorkspaceUsageBarsProps) {
  const max = Math.max(...items.map((i) => i.value), 1)
  return (
    <div className="flex flex-col gap-2.5">
      {items.map((it) =>
        onSelect ? (
          <button
            type="button"
            key={it.workspaceId}
            onClick={() => onSelect(it)}
            className="flex flex-col gap-1 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-foreground/[0.04]"
          >
            <Bar item={it} max={max} format={format} />
          </button>
        ) : (
          <div key={it.workspaceId} className="flex flex-col gap-1">
            <Bar item={it} max={max} format={format} />
          </div>
        ),
      )}
    </div>
  )
}

function Bar({
  item,
  max,
  format,
}: {
  item: WorkspaceUsageItem
  max: number
  format: (value: number) => string
}) {
  return (
    <>
      <div className="flex items-baseline justify-between gap-2 text-[12px]">
        <span className="truncate text-foreground/80">{item.name}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground/70">{format(item.value)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-foreground/[0.05]">
        <div
          className="h-full rounded-full bg-primary/60"
          style={{ width: `${(item.value / max) * 100}%` }}
        />
      </div>
    </>
  )
}
