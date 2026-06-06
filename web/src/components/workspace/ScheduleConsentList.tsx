import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { describeCron } from '@/lib/cron-describe'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface ConsentSchedule {
  name: string
  cron: string
  enabled_default: boolean
}

/** Final overrides map: explicit toggle if set, else the builder's default. */
export function resolveScheduleOverrides(
  schedules: ConsentSchedule[],
  overrides: Record<string, boolean>,
): Record<string, boolean> {
  return Object.fromEntries(schedules.map((s) => [s.name, overrides[s.name] ?? s.enabled_default]))
}

/**
 * The consent toggle list — one row per template-provided schedule with an
 * enable switch (defaulting to the builder's `enabled_default`). Used inline
 * in the create flow and inside `ScheduleConsentDialog` for the sync flow.
 */
export function ScheduleConsentList({
  schedules,
  overrides,
  onChange,
}: {
  schedules: ConsentSchedule[]
  overrides: Record<string, boolean>
  onChange: (next: Record<string, boolean>) => void
}) {
  const { i18n } = useTranslation()
  return (
    <div className="divide-y divide-border rounded-lg border border-border">
      {schedules.map((s) => {
        const enabled = overrides[s.name] ?? s.enabled_default
        return (
          <label key={s.name} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
            <span className="min-w-0">
              <span className="block truncate font-medium text-foreground">{s.name}</span>
              <span className="block truncate font-mono text-muted-foreground">
                {describeCron(s.cron, i18n.language) ?? s.cron}
              </span>
            </span>
            <Switch
              checked={enabled}
              onCheckedChange={(c) => onChange({ ...overrides, [s.name]: c })}
              className="scale-75"
            />
          </label>
        )
      })}
    </div>
  )
}

/** Modal consent prompt used on the sync/upgrade path. */
export function ScheduleConsentDialog({
  open,
  onOpenChange,
  schedules,
  confirming,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  schedules: ConsentSchedule[]
  confirming?: boolean
  onConfirm: (overrides: Record<string, boolean>) => void
}) {
  const { t } = useTranslation()
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})
  useEffect(() => {
    if (open) setOverrides({})
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('components.scheduleConsent.title')}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          {t('components.scheduleConsent.description')}
        </p>
        <ScheduleConsentList schedules={schedules} overrides={overrides} onChange={setOverrides} />
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            size="sm"
            disabled={confirming}
            onClick={() => onConfirm(resolveScheduleOverrides(schedules, overrides))}
          >
            {confirming ? <Spinner size="sm" className="mr-1" /> : null}
            {t('components.scheduleConsent.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
