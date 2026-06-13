// Spike adapter: Extend UI's *experimental* xlsx editor. Fully interactive
// (cell/formula edits, undo/redo, paste, insert/delete rows). It loads the
// workbook from `src` (a URL), matching our `fileUrl` contract.
//
// ⚠️ Persistence gap: the Extend editor's only output path is its toolbar
// "export/download" (@extend-ai/react-xlsx exposes exportXlsx()/download() →
// browser download, no buffer callback). There is NO programmatic hook to feed
// edited bytes back into our workspace save pipeline (onBytesChange), so edits
// made here do NOT persist to the file — they can only be downloaded. Wiring
// real save-back would mean re-serializing from the controller's `sheets`
// state ourselves. Kept here only to evaluate the editing UX.
import { useResolvedTheme } from '@/components/ThemeProvider'
import { XlsxEditorPreview } from './extend/xlsx-editor'

export function ExtendXlsxEditor({
  fileUrl,
  onBytesChange,
}: {
  fileUrl: string
  /** Serialized xlsx bytes after an edit — feeds our workspace save pipeline. */
  onBytesChange?: (bytes: Uint8Array) => void
}) {
  // Theme follows our app; the editor's own theme toggle + export/download +
  // upload buttons are removed in the vendored source so file I/O and theming
  // stay under our control. Edits are bridged back via onBytesChange (the
  // vendored editor watches the controller's revision counter and serializes).
  const isDark = useResolvedTheme() === 'dark'
  return (
    <XlsxEditorPreview
      src={fileUrl}
      isDark={isDark}
      onBytesChange={onBytesChange}
      className="min-h-0 flex-1"
    />
  )
}
