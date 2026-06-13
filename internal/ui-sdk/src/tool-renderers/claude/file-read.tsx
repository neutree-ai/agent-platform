import { transcriptI18n as i18n } from '../../i18n'
import type { ToolCall } from '../types'

export const fileReadRenderer = {
  getPreview(tool: ToolCall): string {
    let s = String(tool.input.file_path || '')
    if (tool.input.offset) s += `:${tool.input.offset}`
    if (tool.input.limit) s += `+${tool.input.limit}`
    return s
  },
  renderInput(tool: ToolCall) {
    const filePath = String(tool.input.file_path || '')
    if (!filePath) return null
    const offset = tool.input.offset as number | undefined
    const limit = tool.input.limit as number | undefined
    const pages = tool.input.pages as string | undefined
    const parts: string[] = []
    if (offset != null && limit != null) {
      parts.push(
        i18n.t('components.chat.toolRenderers.claudeFileRead.labels.lineRange', {
          start: offset,
          end: offset + limit,
        }),
      )
    } else if (offset != null) {
      parts.push(
        i18n.t('components.chat.toolRenderers.claudeFileRead.labels.fromLine', { value: offset }),
      )
    } else if (limit != null) {
      parts.push(
        i18n.t('components.chat.toolRenderers.claudeFileRead.labels.firstLines', {
          count: limit,
        }),
      )
    }
    if (pages) {
      parts.push(
        i18n.t('components.chat.toolRenderers.claudeFileRead.labels.pages', { value: pages }),
      )
    }
    return (
      <div className="space-y-0.5">
        <div className="font-mono text-tiny text-foreground">{filePath}</div>
        {parts.length > 0 && (
          <div className="text-mini text-muted-foreground">{parts.join(' · ')}</div>
        )}
      </div>
    )
  },
  renderResult(): null {
    return null
  },
}
