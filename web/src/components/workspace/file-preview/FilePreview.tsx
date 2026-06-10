import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { useMarkdownPreferencesStore } from '@/stores/markdown-preferences-store'
import { Code, Eye, FileText, Table, WrapText } from 'lucide-react'
import { Suspense, lazy, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isImageFile } from './file-types'

const MarkdownPreview = lazy(() =>
  import('./MarkdownPreview').then((m) => ({ default: m.MarkdownPreview })),
)
const ImagePreview = lazy(() => import('./ImagePreview').then((m) => ({ default: m.ImagePreview })))
const CsvPreview = lazy(() => import('./CsvPreview').then((m) => ({ default: m.CsvPreview })))
const CodePreview = lazy(() => import('./CodePreview').then((m) => ({ default: m.CodePreview })))
const ExcalidrawPreview = lazy(() =>
  import('./ExcalidrawPreview').then((m) => ({ default: m.ExcalidrawPreview })),
)
const OfficePreview = lazy(() =>
  import('./OfficePreview').then((m) => ({ default: m.OfficePreview })),
)
const XlsxPreview = lazy(() => import('./XlsxPreview').then((m) => ({ default: m.XlsxPreview })))
const HtmlPreview = lazy(() => import('./HtmlPreview').then((m) => ({ default: m.HtmlPreview })))

type PreviewType = 'markdown' | 'image' | 'csv' | 'excalidraw' | 'office' | 'xlsx' | 'html' | 'code'

function getPreviewType(filename: string): PreviewType {
  if (isImageFile(filename)) return 'image'
  const ext = filename.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'md':
    case 'mdx':
      return 'markdown'
    case 'csv':
    case 'tsv':
      return 'csv'
    case 'excalidraw':
      return 'excalidraw'
    case 'html':
    case 'htm':
      return 'html'
    case 'xlsx':
    case 'xls':
      return 'xlsx'
    case 'pptx':
    case 'ppt':
    case 'docx':
    case 'doc':
    case 'pdf':
      return 'office'
    default:
      return 'code'
  }
}

function PreviewFallback() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <Spinner className="h-5 w-5" />
    </div>
  )
}

interface FilePreviewProps {
  filename: string
  content: string
  /** URL to fetch the raw file (used for binary previews like images). */
  fileUrl?: string
  /** URL that returns a rendered PDF for Office documents. */
  previewUrl?: string
  isEditing: boolean
  onChange?: (value: string) => void
  /** Binary edit channel for previews whose document isn't a string (xlsx). */
  onBytesChange?: (bytes: Uint8Array) => void
  /** Image-only: go to previous/next image in the directory. Null at boundaries. */
  onPrevImage?: (() => void) | null
  onNextImage?: (() => void) | null
  /** Code-only: scroll to (line, col) on mount/content-load, briefly highlight. */
  viewingLine?: number
  viewingColumn?: number
}

export function FilePreview({
  filename,
  content,
  fileUrl,
  previewUrl,
  isEditing,
  onChange,
  onBytesChange,
  onPrevImage,
  onNextImage,
  viewingLine,
  viewingColumn,
}: FilePreviewProps) {
  const { t } = useTranslation()
  const previewType = getPreviewType(filename)
  const hasSourceToggle =
    previewType === 'markdown' ||
    previewType === 'csv' ||
    previewType === 'excalidraw' ||
    previewType === 'html'
  const [showRendered, setShowRendered] = useState(previewType !== 'code')
  // For xlsx: lightweight spreadsheet view is the default. There's also a
  // server-side Office mode (Gotenberg/LibreOffice → PDF) wired up below, but
  // its entry point is currently hidden because LibreOffice's xlsx-to-PDF
  // output is poor — pages truncate columns, charts often misrender, and the
  // result is usually worse than our hand-rolled spreadsheet view. Leaving
  // the plumbing in place so we can revisit when we have a better converter
  // (or the spreadsheet view hits a limitation that's worth the tradeoff).
  const [xlsxOfficeMode, setXlsxOfficeMode] = useState(false)
  // Soft-wrap long lines in the CodeMirror surface. Off by default so the
  // default reading experience stays faithful to the file's real line breaks.
  const [wrap, setWrap] = useState(false)

  // Which surface to render:
  //   - image / office: always rendered (no source view exists)
  //   - excalidraw: follows the toggle in both view and edit modes — the
  //     canvas is itself the editor, so "edit" shouldn't force JSON source
  //   - everything else: editing forces the code view
  const isCanvasEditor = previewType === 'excalidraw'
  const useRendered =
    previewType === 'image' ||
    previewType === 'office' ||
    previewType === 'xlsx' ||
    (showRendered && (isCanvasEditor || !isEditing))
  const showSourceToggle = hasSourceToggle && (isCanvasEditor || !isEditing)
  const showTocToggle = previewType === 'markdown' && useRendered
  // The wrap toggle only makes sense for the CodeMirror surface, which renders
  // whenever no rendered preview is active (code files + any "source" view).
  const showWrapToggle = !useRendered
  const tocVisible = useMarkdownPreferencesStore((s) => s.tocVisible)
  const setTocVisible = useMarkdownPreferencesStore((s) => s.setTocVisible)
  // Office-mode toggle is intentionally suppressed — see xlsxOfficeMode comment.
  const showXlsxModeToggle = false

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {(showSourceToggle || showTocToggle || showWrapToggle) && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border/50 px-3 py-0.5">
          {showSourceToggle && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-xs text-muted-foreground"
              onClick={() => setShowRendered((v) => !v)}
            >
              {useRendered ? (
                <>
                  <Code className="h-3 w-3" /> {t('components.filePreview.actions.source')}
                </>
              ) : (
                <>
                  <Eye className="h-3 w-3" /> {t('components.filePreview.actions.preview')}
                </>
              )}
            </Button>
          )}
          {showWrapToggle && (
            <Button
              variant="ghost"
              size="sm"
              aria-pressed={wrap}
              className={`h-6 gap-1 px-2 text-xs ${wrap ? 'text-foreground' : 'text-muted-foreground'}`}
              onClick={() => setWrap((v) => !v)}
            >
              <WrapText className="h-3 w-3" /> {t('components.filePreview.actions.wrap')}
            </Button>
          )}
          {showTocToggle && (
            <label className="ml-auto flex h-6 cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <span>{t('components.filePreview.actions.toc')}</span>
              <Switch
                checked={tocVisible}
                onCheckedChange={setTocVisible}
                aria-label={t('components.filePreview.actions.toc')}
              />
            </label>
          )}
        </div>
      )}
      {showXlsxModeToggle && (
        <div className="flex shrink-0 items-center border-b border-border/50 px-3 py-0.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-2 text-xs text-muted-foreground"
            onClick={() => setXlsxOfficeMode((v) => !v)}
          >
            {xlsxOfficeMode ? (
              <>
                <Table className="h-3 w-3" /> {t('components.filePreview.actions.spreadsheet')}
              </>
            ) : (
              <>
                <FileText className="h-3 w-3" /> {t('components.filePreview.actions.officeMode')}
              </>
            )}
          </Button>
        </div>
      )}
      <Suspense fallback={<PreviewFallback />}>
        {useRendered && previewType === 'markdown' ? (
          <MarkdownPreview content={content} />
        ) : useRendered && previewType === 'image' && fileUrl ? (
          <ImagePreview
            src={fileUrl}
            filename={filename}
            onPrev={onPrevImage ?? null}
            onNext={onNextImage ?? null}
          />
        ) : useRendered && previewType === 'csv' ? (
          <CsvPreview content={content} filename={filename} />
        ) : useRendered && previewType === 'excalidraw' ? (
          <ExcalidrawPreview content={content} isEditing={isEditing} onChange={onChange} />
        ) : useRendered && previewType === 'html' ? (
          <HtmlPreview content={content} filename={filename} />
        ) : useRendered && previewType === 'xlsx' && fileUrl && !xlsxOfficeMode ? (
          <XlsxPreview
            fileUrl={fileUrl}
            isEditing={isEditing}
            onBytesChange={isEditing ? onBytesChange : undefined}
          />
        ) : useRendered &&
          (previewType === 'office' || (previewType === 'xlsx' && xlsxOfficeMode)) &&
          previewUrl &&
          fileUrl ? (
          <OfficePreview previewUrl={previewUrl} downloadUrl={fileUrl} filename={filename} />
        ) : (
          <CodePreview
            filename={filename}
            content={content}
            isEditing={isEditing}
            onChange={onChange}
            wrap={wrap}
            viewingLine={viewingLine}
            viewingColumn={viewingColumn}
          />
        )}
      </Suspense>
    </div>
  )
}
