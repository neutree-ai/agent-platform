import { Button } from '@/components/ui/button'
import { DocumentedDialog } from '@/components/ui/documented-dialog'
import { Label } from '@/components/ui/label'
import { SaveButton } from '@/components/ui/save-button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getBrowserLaunchDoc } from '@/docs/inline-help/misc-docs'
import { useCreateBrowser } from '@/hooks/useBrowsers'
import { type ReactNode, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const TIMEOUT_PRESETS = [
  {
    seconds: 600,
    labelKey: 'components.workspaceBrowser.timeout.10m.label',
    descKey: 'components.workspaceBrowser.timeout.10m.desc',
  },
  {
    seconds: 3600,
    labelKey: 'components.workspaceBrowser.timeout.1h.label',
    descKey: 'components.workspaceBrowser.timeout.1h.desc',
  },
  {
    seconds: 21600,
    labelKey: 'components.workspaceBrowser.timeout.6h.label',
    descKey: 'components.workspaceBrowser.timeout.6h.desc',
  },
  {
    seconds: 86400,
    labelKey: 'components.workspaceBrowser.timeout.24h.label',
    descKey: 'components.workspaceBrowser.timeout.24h.desc',
  },
] as const

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
}

export function LaunchBrowserDialog({ open, onOpenChange, workspaceId }: Props) {
  const { t } = useTranslation()
  const createMutation = useCreateBrowser(workspaceId)
  const [timeoutSeconds, setTimeoutSeconds] = useState(3600)

  useEffect(() => {
    if (open) setTimeoutSeconds(3600)
  }, [open])

  async function handleLaunch() {
    try {
      await createMutation.mutateAsync({ timeout_seconds: timeoutSeconds })
      onOpenChange(false)
    } catch {
      // toast surfaced by hook
    }
  }

  return (
    <DocumentedDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('components.workspaceBrowser.dialogs.launchTitle')}
      docs={getBrowserLaunchDoc()}
      docsHint={t('components.workspaceBrowser.dialogs.docsHint')}
      footer={
        <>
          <Button type="button" size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <SaveButton
            isSaving={createMutation.isPending}
            onClick={handleLaunch}
            label={t('components.workspaceBrowser.actions.launch')}
          />
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('components.workspaceBrowser.timeoutLabel')} htmlFor="browser-timeout">
          <Select
            value={String(timeoutSeconds)}
            onValueChange={(v) => setTimeoutSeconds(Number(v))}
          >
            <SelectTrigger id="browser-timeout" className="h-9 text-sm focus:ring-inset">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIMEOUT_PRESETS.map((p) => (
                <SelectItem
                  key={p.seconds}
                  value={String(p.seconds)}
                  className="py-2"
                  description={t(p.descKey)}
                >
                  {t(p.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
    </DocumentedDialog>
  )
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor?: string
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </Label>
      {children}
    </div>
  )
}
