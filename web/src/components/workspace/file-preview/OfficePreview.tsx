import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Download } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface OfficePreviewProps {
  previewUrl: string
  downloadUrl: string
  filename: string
}

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; blobUrl: string }
  | { kind: 'unsupported' }
  | { kind: 'error' }

export function OfficePreview({ previewUrl, downloadUrl, filename }: OfficePreviewProps) {
  const { t } = useTranslation()
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    let createdUrl: string | null = null
    setState({ kind: 'loading' })

    fetch(previewUrl)
      .then(async (r) => {
        if (cancelled) return
        if (r.status === 501) {
          setState({ kind: 'unsupported' })
          return
        }
        if (!r.ok) {
          setState({ kind: 'error' })
          return
        }
        const blob = await r.blob()
        if (cancelled) return
        createdUrl = URL.createObjectURL(blob)
        setState({ kind: 'ready', blobUrl: createdUrl })
      })
      .catch(() => {
        if (!cancelled) setState({ kind: 'error' })
      })

    return () => {
      cancelled = true
      if (createdUrl) URL.revokeObjectURL(createdUrl)
    }
  }, [previewUrl])

  if (state.kind === 'loading') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2">
        <Spinner className="h-5 w-5" />
        <span className="text-xs text-muted-foreground">
          {t('components.officePreview.rendering')}
        </span>
      </div>
    )
  }

  if (state.kind === 'unsupported' || state.kind === 'error') {
    const messageKey =
      state.kind === 'unsupported'
        ? 'components.officePreview.unsupported'
        : 'components.officePreview.failed'
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <span className="text-sm text-muted-foreground">{t(messageKey)}</span>
        <Button asChild variant="outline" size="sm">
          <a href={downloadUrl} download={filename}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            {t('components.officePreview.download')}
          </a>
        </Button>
      </div>
    )
  }

  return (
    <iframe src={state.blobUrl} title={filename} className="min-h-0 flex-1 border-0 bg-white" />
  )
}
