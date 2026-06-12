import { type ToolCall, getMcpText, unwrapMcpInput } from '../types'

export const readMemoryRenderer = {
  getPreview(): string {
    return ''
  },
  renderInput() {
    return <div />
  },
  renderResult(tool: ToolCall) {
    const text = getMcpText(tool.result)
    if (!text) return null
    return (
      <pre className="whitespace-pre-wrap text-tiny font-mono rounded bg-muted/50 p-1.5 overflow-x-auto max-h-[300px] overflow-y-auto">
        {text}
      </pre>
    )
  },
}

export const updateMemoryRenderer = {
  getPreview(tool: ToolCall): string {
    const input = unwrapMcpInput(tool.input)
    return String(input.mode || '')
  },
  renderInput(tool: ToolCall) {
    const input = unwrapMcpInput(tool.input)
    const mode = input.mode as string | undefined
    const content = input.content as string | undefined
    if (!content) return null
    return (
      <div className="space-y-1">
        {mode && (
          <span className="px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground text-mini">
            {mode}
          </span>
        )}
        <pre className="whitespace-pre-wrap text-tiny font-mono rounded bg-muted/50 p-1.5 overflow-x-auto max-h-40 overflow-y-auto">
          {content}
        </pre>
      </div>
    )
  },
  renderResult(tool: ToolCall) {
    const text = getMcpText(tool.result)
    if (!text) return null
    return <div className="text-tiny text-muted-foreground">{text}</div>
  },
}
