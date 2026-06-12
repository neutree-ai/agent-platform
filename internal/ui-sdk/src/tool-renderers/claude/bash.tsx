import { transcriptI18n as i18n } from '../../i18n'
import { type ToolCall, truncate } from '../types'

export const bashRenderer = {
  getPreview(tool: ToolCall): string {
    if (tool.input.description) return truncate(String(tool.input.description))
    if (tool.input.command) return truncate(String(tool.input.command))
    return ''
  },

  renderInput(tool: ToolCall) {
    const cmd = String(tool.input.command || '')
    if (!cmd) return null
    return (
      <div>
        <div className="text-xs text-muted-foreground mb-1">
          {i18n.t('components.chat.toolRenderers.claudeBash.labels.command')}
        </div>
        <pre className="text-tiny bg-muted border border-foreground/[0.08] p-2 rounded-md overflow-x-auto font-mono">
          {cmd}
        </pre>
      </div>
    )
  },

  renderResult(): null {
    return null
  },
}
