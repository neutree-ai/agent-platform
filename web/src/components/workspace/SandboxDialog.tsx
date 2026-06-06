import { Button } from '@/components/ui/button'
import { DocumentedDialog } from '@/components/ui/documented-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SaveButton } from '@/components/ui/save-button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getSandboxDoc } from '@/docs/inline-help/misc-docs'
import { useCreateSandbox } from '@/hooks/useSandboxes'
import { type ReactNode, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

// Only images backed by sandbox-service prewarm pools. Other images would
// pull on-demand and bottleneck cold-start, so we don't list them as
// presets — users with non-prewarmed images go through "Custom…" and
// accept the latency. List will grow once a prewarm registration API
// lands; do not add speculative entries here.
const IMAGE_PRESETS = ['node:22-bookworm', 'python:3.12-bookworm'] as const

const CUSTOM_IMAGE = '__custom__'

// T-shirt sizes for compute. Resource limits stay hidden behind a name so
// users don't need to know k8s unit syntax (`500m`, `512Mi`) up front.
// The custom row is always available for advanced cases.
const SIZE_PRESETS: { key: SizeKey; cpu: string; memory: string }[] = [
  { key: 'small', cpu: '250m', memory: '256Mi' },
  { key: 'medium', cpu: '500m', memory: '512Mi' },
  { key: 'large', cpu: '1', memory: '1Gi' },
  { key: 'xlarge', cpu: '2', memory: '2Gi' },
]
type SizeKey = 'small' | 'medium' | 'large' | 'xlarge' | 'custom'

const TIMEOUT_PRESETS: { seconds: number; key: TimeoutKey }[] = [
  { seconds: 600, key: '10m' },
  { seconds: 3600, key: '1h' },
  { seconds: 21600, key: '6h' },
  { seconds: 86400, key: '24h' },
]
type TimeoutKey = '10m' | '1h' | '6h' | '24h'

interface Props {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SandboxDialog({ workspaceId, open, onOpenChange }: Props) {
  const { t } = useTranslation()
  const createMutation = useCreateSandbox(workspaceId)

  const [imageChoice, setImageChoice] = useState<string>(IMAGE_PRESETS[0])
  const [customImage, setCustomImage] = useState('')
  const [size, setSize] = useState<SizeKey>('medium')
  const [customCpu, setCustomCpu] = useState('500m')
  const [customMemory, setCustomMemory] = useState('512Mi')
  const [timeoutSeconds, setTimeoutSeconds] = useState(3600)

  // Reset to defaults whenever the dialog reopens — registry-style dialogs
  // persist mounted, otherwise stale form state from a prior open carries
  // over and surprises the user.
  useEffect(() => {
    if (!open) return
    setImageChoice(IMAGE_PRESETS[0])
    setCustomImage('')
    setSize('medium')
    setCustomCpu('500m')
    setCustomMemory('512Mi')
    setTimeoutSeconds(3600)
  }, [open])

  const isCustomImage = imageChoice === CUSTOM_IMAGE
  const finalImage = isCustomImage ? customImage.trim() : imageChoice
  const isCustomSize = size === 'custom'
  const sizeSpec = SIZE_PRESETS.find((s) => s.key === size)
  const cpu = isCustomSize ? customCpu.trim() : (sizeSpec?.cpu ?? '500m')
  const memory = isCustomSize ? customMemory.trim() : (sizeSpec?.memory ?? '512Mi')
  const canSubmit =
    finalImage.length > 0 && cpu.length > 0 && memory.length > 0 && !createMutation.isPending

  async function handleCreate() {
    if (!canSubmit) return
    try {
      await createMutation.mutateAsync({
        image: finalImage,
        resource: { cpu, memory },
        timeout_seconds: timeoutSeconds,
      })
      onOpenChange(false)
    } catch {
      // toast shown by hook
    }
  }

  return (
    <DocumentedDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('components.workspaceSandbox.dialog.title')}
      docs={getSandboxDoc()}
      size="lg"
      footer={
        <>
          <Button type="button" size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <SaveButton
            isSaving={createMutation.isPending}
            disabled={!canSubmit}
            onClick={handleCreate}
            label={t('common.create')}
          />
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('components.workspaceSandbox.fields.image')} htmlFor="sandbox-image">
          <Select value={imageChoice} onValueChange={setImageChoice}>
            <SelectTrigger id="sandbox-image" className="h-9 text-sm focus:ring-inset">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {IMAGE_PRESETS.map((img) => (
                <SelectItem key={img} value={img} className="font-mono text-xs">
                  {img}
                </SelectItem>
              ))}
              <SelectItem value={CUSTOM_IMAGE} className="text-xs">
                {t('components.workspaceSandbox.fields.imageCustom')}
              </SelectItem>
            </SelectContent>
          </Select>
          {isCustomImage && (
            <Input
              autoFocus
              value={customImage}
              onChange={(e) => setCustomImage(e.target.value)}
              placeholder={t('components.workspaceSandbox.placeholders.image')}
              className="mt-2 h-9 font-mono text-xs"
            />
          )}
        </Field>

        <Field label={t('components.workspaceSandbox.fields.size')} htmlFor="sandbox-size">
          <Select value={size} onValueChange={(v) => setSize(v as SizeKey)}>
            <SelectTrigger id="sandbox-size" className="h-9 text-sm focus:ring-inset">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SIZE_PRESETS.map((s) => (
                <SelectItem
                  key={s.key}
                  value={s.key}
                  className="py-1.5"
                  description={`${s.cpu} · ${s.memory}`}
                >
                  {t(`components.workspaceSandbox.sizes.${s.key}.label`)}
                </SelectItem>
              ))}
              <SelectItem value="custom" className="text-xs">
                {t('components.workspaceSandbox.sizes.custom.label')}
              </SelectItem>
            </SelectContent>
          </Select>
          {isCustomSize && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  {t('components.workspaceSandbox.fields.cpu')}
                </Label>
                <Input
                  value={customCpu}
                  onChange={(e) => setCustomCpu(e.target.value)}
                  placeholder={t('components.workspaceSandbox.placeholders.cpu')}
                  className="h-9 font-mono text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  {t('components.workspaceSandbox.fields.memory')}
                </Label>
                <Input
                  value={customMemory}
                  onChange={(e) => setCustomMemory(e.target.value)}
                  placeholder={t('components.workspaceSandbox.placeholders.memory')}
                  className="h-9 font-mono text-xs"
                />
              </div>
            </div>
          )}
        </Field>

        <Field label={t('components.workspaceSandbox.fields.timeout')} htmlFor="sandbox-timeout">
          <Select
            value={String(timeoutSeconds)}
            onValueChange={(v) => setTimeoutSeconds(Number(v))}
          >
            <SelectTrigger id="sandbox-timeout" className="h-9 text-sm focus:ring-inset">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIMEOUT_PRESETS.map((p) => (
                <SelectItem key={p.key} value={String(p.seconds)} className="py-1.5">
                  {t(`components.workspaceSandbox.timeouts.${p.key}`)}
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
