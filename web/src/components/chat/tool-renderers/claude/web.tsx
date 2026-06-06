import type { ToolCall } from '../types'

export const webFetchRenderer = {
  getPreview(tool: ToolCall): string {
    return String(tool.input.url || '')
  },
  renderInput(tool: ToolCall) {
    const url = String(tool.input.url || '')
    const prompt = String(tool.input.prompt || '')
    if (!url) return null
    return (
      <div className="space-y-1">
        <div className="text-tiny font-mono text-info truncate">{url}</div>
        {prompt && <div className="text-tiny text-muted-foreground italic">{prompt}</div>}
      </div>
    )
  },
  renderResult(): null {
    return null
  },
}

export const webSearchRenderer = {
  getPreview(tool: ToolCall): string {
    return `"${tool.input.query || ''}"`
  },
  renderInput(): null {
    return null
  },
  renderResult(): null {
    return null
  },
}
