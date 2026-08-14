import { ConfirmButton } from '@/components/ui/confirm-button'
import type { LucideIcon } from 'lucide-react'

interface ResourceRowProps {
  name: string
  /** The measure that earns this row its place — core-hours, GiB. */
  amount: string
  /** How long it has been in this state, already formatted. */
  detail: string
  action: {
    icon: LucideIcon
    label: string
    confirmLabel: string
    onConfirm: () => void
    pending: boolean
  }
}

/**
 * One reclaimable workspace: what it is, what it is holding, and the single
 * action that releases it. The action arms on first click and fires on the
 * second — the panel is too narrow for a dialog, and stopping or deleting
 * someone's workspace is not a thing to do on a stray click.
 */
export function ResourceRow({ name, amount, detail, action }: ResourceRowProps) {
  const Icon = action.icon
  return (
    <div className="flex items-center gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[12px] text-foreground/80">{name}</span>
        <span className="text-[11px] text-muted-foreground/60">{detail}</span>
      </div>
      <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground/70">{amount}</span>
      <ConfirmButton
        variant="ghost"
        size="sm"
        className="shrink-0 gap-1.5 text-[11px]"
        disabled={action.pending}
        icon={<Icon className="h-3.5 w-3.5" />}
        confirmLabel={action.confirmLabel}
        onConfirm={action.onConfirm}
      >
        {action.label}
      </ConfirmButton>
    </div>
  )
}
