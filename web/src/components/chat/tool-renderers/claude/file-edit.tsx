import { DiffView } from '@/components/ui/diff-view'
import i18n from '@/lib/i18n'
import type { ToolCall } from '../types'

export const fileEditRenderer = {
  getPreview(tool: ToolCall): string {
    return String(tool.input.file_path || '')
  },

  renderInput(tool: ToolCall) {
    const filePath = String(tool.input.file_path || '')
    const oldStr = tool.input.old_string as string | undefined
    const newStr = tool.input.new_string as string | undefined
    // Write tool: show file path + content preview
    const content = tool.input.content as string | undefined
    if (content !== undefined) {
      return (
        <div className="space-y-1">
          <div className="font-mono text-tiny text-foreground">{filePath}</div>
          <pre className="text-tiny bg-muted border border-foreground/[0.08] p-2 rounded-md overflow-x-auto font-mono max-h-60 overflow-y-auto">
            {content}
          </pre>
        </div>
      )
    }
    // Edit tool: show old → new diff
    if (oldStr == null && newStr == null) return null
    return (
      <div className="space-y-1">
        <div className="font-mono text-tiny text-foreground">{filePath}</div>
        <div className="rounded overflow-hidden border border-foreground/[0.08] max-h-60 overflow-y-auto">
          <DiffView
            oldText={oldStr ?? ''}
            newText={newStr ?? ''}
            oldLabel={i18n.t('components.chat.toolRenderers.claudeFileEdit.labels.old')}
            newLabel={i18n.t('components.chat.toolRenderers.claudeFileEdit.labels.new')}
          />
        </div>
        {tool.input.replace_all === true && (
          <div className="text-mini text-muted-foreground">
            {i18n.t('components.chat.toolRenderers.claudeFileEdit.labels.replaceAllOccurrences')}
          </div>
        )}
      </div>
    )
  },

  renderResult(): null {
    return null
  },
}
