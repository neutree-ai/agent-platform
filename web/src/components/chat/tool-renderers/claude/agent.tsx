import { type ToolCall, truncate } from '../types'

export const agentRenderer = {
  getPreview(tool: ToolCall): string {
    return `${tool.input.description || ''}${tool.input.subagent_type ? ` (${tool.input.subagent_type})` : ''}`
  },

  renderInput(tool: ToolCall) {
    const desc = String(tool.input.description || '')
    const prompt = String(tool.input.prompt || '')
    const subagentType = tool.input.subagent_type as string | undefined
    const model = tool.input.model as string | undefined
    if (!desc && !prompt) return null
    return (
      <div className="space-y-1.5">
        {(subagentType || model) && (
          <div className="flex items-center gap-1.5">
            {subagentType && (
              <span className="px-1.5 py-0.5 rounded bg-info/20 text-info text-mini">
                {subagentType}
              </span>
            )}
            {model && (
              <span className="px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground text-mini">
                {model}
              </span>
            )}
          </div>
        )}
        {desc && <div className="text-tiny text-foreground">{desc}</div>}
        {prompt && (
          <pre className="text-tiny text-muted-foreground bg-muted border border-foreground/[0.08] p-2 rounded-md overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap">
            {truncate(prompt, 500)}
          </pre>
        )}
      </div>
    )
  },

  renderResult(): null {
    return null
  },
}
