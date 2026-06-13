// Read-only xlsx preview via Extend UI's XlsxViewerPreview. It takes a `src`
// URL and loads/parses the workbook itself (@extend-ai/react-xlsx). Editing
// goes through ExtendXlsxEditor instead.
//
// Toolbar control is unified with our app: upload + download are disabled, and
// the workbook theme follows our app theme (the night-render toggle is removed
// in the vendored source — see shouldRenderNightMode={false} there).
import { useResolvedTheme } from '@/components/ThemeProvider'
import { XlsxViewerPreview } from './extend/xlsx-viewer'

export function ExtendXlsxPreview({ fileUrl }: { fileUrl: string }) {
  const isDark = useResolvedTheme() === 'dark'
  return (
    <XlsxViewerPreview
      src={fileUrl}
      isDark={isDark}
      showUpload={false}
      showDownload={false}
      className="min-h-0 flex-1"
    />
  )
}
