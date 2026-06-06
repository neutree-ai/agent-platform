import { useResolvedTheme } from '@/components/ThemeProvider'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Spinner } from '@/components/ui/spinner'
import { loadExcalidraw } from '@/lib/excalidraw-loader'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

if (
  typeof window !== 'undefined' &&
  !(window as unknown as { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH
) {
  ;(window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH =
    '/excalidraw-assets/'
}

const EMIT_DEBOUNCE_MS = 250

interface ExcalidrawPreviewProps {
  content: string
  isEditing?: boolean
  onChange?: (value: string) => void
}

export function ExcalidrawPreview({
  content,
  isEditing = false,
  onChange,
}: ExcalidrawPreviewProps) {
  const { t } = useTranslation()
  const resolvedTheme = useResolvedTheme()
  const [mod, setMod] = useState<typeof import('@excalidraw/excalidraw') | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const apiRef = useRef<any>(null)
  // Last JSON we emitted upward. Used to suppress the updateScene() round-trip
  // when our own onChange comes back as a new `content` prop.
  const lastEmittedRef = useRef<string | null>(null)
  const emitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    loadExcalidraw()
      .then((m) => setMod(m))
      .catch((err) => setLoadError(err.message))
  }, [])

  const parsed = useMemo(() => {
    // Empty content means the parent fetch hasn't landed yet — treat as
    // loading instead of flashing "invalid JSON" before the real bytes arrive.
    if (content === '') return { ok: 'pending' as const }
    try {
      const data = JSON.parse(content)
      return {
        ok: true as const,
        elements: data.elements ?? [],
        appState: { ...(data.appState ?? {}), collaborators: new Map() },
        files: data.files ?? {},
      }
    } catch (err) {
      return { ok: false as const, error: (err as Error).message }
    }
  }, [content])

  // Excalidraw is uncontrolled: initialData seeds the first mount only.
  // Push subsequent external content changes via the imperative API so we
  // don't remount (which would wipe selection / undo history).
  useEffect(() => {
    if (!apiRef.current || parsed.ok !== true) return
    if (lastEmittedRef.current === content) return
    apiRef.current.updateScene({ elements: parsed.elements, appState: parsed.appState })
  }, [content, parsed])

  useEffect(
    () => () => {
      if (emitTimerRef.current) clearTimeout(emitTimerRef.current)
    },
    [],
  )

  if (parsed.ok === 'pending') {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner className="h-5 w-5" />
      </div>
    )
  }

  if (!parsed.ok) {
    return (
      <div className="flex-1 p-3">
        <Alert variant="destructive">
          <AlertDescription>
            {t('components.excalidrawPreview.invalidFile', { error: parsed.error })}
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="flex-1 p-3">
        <Alert variant="destructive">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      </div>
    )
  }

  if (!mod) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner className="h-5 w-5" />
      </div>
    )
  }

  const { Excalidraw, serializeAsJSON } = mod
  const editable = isEditing && !!onChange

  const initialData = { elements: parsed.elements, appState: parsed.appState, files: parsed.files }

  const handleChange = (elements: any, appState: any, files: any) => {
    if (!editable) return
    if (emitTimerRef.current) clearTimeout(emitTimerRef.current)
    emitTimerRef.current = setTimeout(() => {
      const json = serializeAsJSON(elements, appState, files, 'local')
      if (json === lastEmittedRef.current) return
      lastEmittedRef.current = json
      onChange?.(json)
    }, EMIT_DEBOUNCE_MS)
  }

  return (
    <div className="min-h-0 flex-1">
      <Excalidraw
        excalidrawAPI={(api: any) => {
          apiRef.current = api
        }}
        initialData={initialData}
        viewModeEnabled={!editable}
        zenModeEnabled={!editable}
        theme={resolvedTheme}
        onChange={handleChange}
        UIOptions={{
          canvasActions: {
            saveToActiveFile: false,
            saveAsImage: false,
            export: false,
            loadScene: false,
          },
        }}
      />
    </div>
  )
}
