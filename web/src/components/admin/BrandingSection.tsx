import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { api } from '@/lib/api/client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card } from '@tremor/react'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const LOGO_MAX_BYTES = 256 * 1024
const LOGO_ACCEPT = 'image/svg+xml,image/png,image/jpeg,image/x-icon'

function readFileAsDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

// instanceId reserved for future per-instance UI state — currently unused.
export function BrandingSection(_: { instanceId: string }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const fieldId = useId()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const settings = useQuery({
    queryKey: ['admin', 'system-settings'],
    queryFn: () => api.getSystemSettings(),
  })

  const [shortName, setShortName] = useState('')
  const [fullName, setFullName] = useState('')
  // Pending logo change: undefined = no change, null = clear to default,
  // {data, mime} = a newly picked file awaiting save.
  const [pendingLogo, setPendingLogo] = useState<{ data: string; mime: string } | null | undefined>(
    undefined,
  )
  const [logoError, setLogoError] = useState<string | null>(null)

  useEffect(() => {
    if (!settings.data) return
    setShortName(settings.data.branding_short_name ?? '')
    setFullName(settings.data.branding_full_name ?? '')
    setPendingLogo(undefined)
    setLogoError(null)
  }, [settings.data])

  const save = useMutation({
    mutationFn: async () => {
      const patch: Parameters<typeof api.updateSystemSettings>[0] = {
        branding_short_name: shortName.trim() || null,
        branding_full_name: fullName.trim() || null,
      }
      if (pendingLogo === null) {
        patch.branding_logo_data = null
        patch.branding_logo_mime = null
      } else if (pendingLogo) {
        patch.branding_logo_data = pendingLogo.data
        patch.branding_logo_mime = pendingLogo.mime
      }
      return api.updateSystemSettings(patch)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'system-settings'] })
    },
  })

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setLogoError(null)
    if (file.size > LOGO_MAX_BYTES) {
      setLogoError(t('components.admin.brandingSection.errors.logoTooLarge'))
      return
    }
    const dataUri = await readFileAsDataUri(file)
    const base64 = dataUri.split(',')[1]
    if (!base64) {
      setLogoError(t('components.admin.brandingSection.errors.logoReadFailed'))
      return
    }
    setPendingLogo({ data: base64, mime: file.type })
  }

  if (settings.isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner />
      </div>
    )
  }

  if (settings.error || !settings.data) {
    return (
      <p className="py-8 text-center text-xs text-muted-foreground">
        {t('components.admin.brandingSection.errors.loadFailed')}
      </p>
    )
  }

  const currentHasLogo = !!settings.data.branding_logo_data
  // What the logo preview shows: a freshly-picked file, "cleared" (no
  // preview), or whatever's currently saved (if any).
  const previewSrc =
    pendingLogo === null
      ? null
      : pendingLogo
        ? `data:${pendingLogo.mime};base64,${pendingLogo.data}`
        : currentHasLogo
          ? '/api/branding/logo'
          : null

  return (
    <div className="space-y-3 p-1">
      <Card className="!bg-card !ring-border !p-4">
        <p className="text-xs text-muted-foreground">
          {t('components.admin.brandingSection.description')}
        </p>

        <div className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-short`} className="text-xs">
              {t('components.admin.brandingSection.shortName')}
            </Label>
            <Input
              id={`${fieldId}-short`}
              value={shortName}
              onChange={(e) => setShortName(e.target.value)}
              placeholder="NAP"
              className="h-8 text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-full`} className="text-xs">
              {t('components.admin.brandingSection.fullName')}
            </Label>
            <Input
              id={`${fieldId}-full`}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Neutree Agent Platform"
              className="h-8 text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">{t('components.admin.brandingSection.logo')}</Label>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-input bg-background">
                {previewSrc ? (
                  <img src={previewSrc} alt="" className="h-full w-full object-contain p-1" />
                ) : (
                  <span className="text-tiny text-muted-foreground">—</span>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept={LOGO_ACCEPT}
                className="hidden"
                onChange={handleFileChange}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={save.isPending}
              >
                {t('components.admin.brandingSection.uploadLogo')}
              </Button>
              {previewSrc && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPendingLogo(null)}
                  disabled={save.isPending}
                >
                  {t('components.admin.brandingSection.clearLogo')}
                </Button>
              )}
            </div>
            <p className="text-tiny text-muted-foreground">
              {t('components.admin.brandingSection.logoHint')}
            </p>
          </div>

          {logoError && (
            <Alert variant="destructive">
              <AlertDescription className="text-xs">{logoError}</AlertDescription>
            </Alert>
          )}

          {save.isError && (
            <Alert variant="destructive">
              <AlertDescription className="text-xs">
                {save.error instanceof Error
                  ? save.error.message
                  : t('components.admin.brandingSection.errors.saveFailed')}
              </AlertDescription>
            </Alert>
          )}

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setShortName(settings.data?.branding_short_name ?? '')
                setFullName(settings.data?.branding_full_name ?? '')
                setPendingLogo(undefined)
                setLogoError(null)
              }}
              disabled={save.isPending}
            >
              {t('components.admin.brandingSection.actions.reset')}
            </Button>
            <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending
                ? t('components.admin.brandingSection.actions.saving')
                : t('components.admin.brandingSection.actions.save')}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
