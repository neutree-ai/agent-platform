import i18n from '@/lib/i18n'
import type { ToolCall } from '../types'

export const globRenderer = {
  getPreview(tool: ToolCall): string {
    return tool.input.path
      ? i18n.t('components.chat.toolRenderers.claudeSearch.preview.patternInPath', {
          pattern: String(tool.input.pattern || ''),
          path: String(tool.input.path || ''),
        })
      : String(tool.input.pattern || '')
  },
  renderInput(tool: ToolCall) {
    const pattern = String(tool.input.pattern || '')
    const path = tool.input.path as string | undefined
    if (!pattern) return null
    return (
      <div className="space-y-0.5">
        <div className="text-tiny font-mono text-foreground">{pattern}</div>
        {path && (
          <div className="text-mini text-muted-foreground">
            {i18n.t('components.chat.toolRenderers.claudeSearch.labels.inPath', { value: path })}
          </div>
        )}
      </div>
    )
  },
  renderResult(): null {
    return null
  },
}

export const grepRenderer = {
  getPreview(tool: ToolCall): string {
    let s = `/${tool.input.pattern || ''}/`
    if (tool.input.glob) s += ` ${tool.input.glob}`
    else if (tool.input.path) s += ` in ${tool.input.path}`
    return s
  },
  renderInput(tool: ToolCall) {
    const pattern = String(tool.input.pattern || '')
    const path = tool.input.path as string | undefined
    const glob = tool.input.glob as string | undefined
    const type = tool.input.type as string | undefined
    const mode = tool.input.output_mode as string | undefined
    const caseInsensitive = tool.input['-i'] === true
    if (!pattern) return null
    return (
      <div className="space-y-0.5">
        <div className="text-tiny font-mono text-foreground">
          <span className="text-muted-foreground">/</span>
          {pattern}
          <span className="text-muted-foreground">/</span>
          {caseInsensitive && <span className="text-muted-foreground">i</span>}
        </div>
        <div className="flex items-center gap-2 text-mini text-muted-foreground flex-wrap">
          {glob && (
            <span>
              {i18n.t('components.chat.toolRenderers.claudeSearch.labels.glob', { value: glob })}
            </span>
          )}
          {path && (
            <span>
              {i18n.t('components.chat.toolRenderers.claudeSearch.labels.inPath', { value: path })}
            </span>
          )}
          {type && (
            <span>
              {i18n.t('components.chat.toolRenderers.claudeSearch.labels.type', { value: type })}
            </span>
          )}
          {mode && (
            <span>
              {i18n.t('components.chat.toolRenderers.claudeSearch.labels.mode', { value: mode })}
            </span>
          )}
        </div>
      </div>
    )
  },
  renderResult(): null {
    return null
  },
}
