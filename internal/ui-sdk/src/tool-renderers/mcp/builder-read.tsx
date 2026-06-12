import { type ToolCall, getMcpText, truncate, unwrapMcpInput } from '../types'

/**
 * Shared renderer for Builder Mode read tools (`list_*`, `get_*`, and
 * `get_workspace_config`). The cp side returns plain text — not JSON — so
 * this renderer just renders the input filters as inline chips and the
 * result as a monospace pre block. No JSON parsing, no per-tool shape.
 */
export const builderReadRenderer = {
  getPreview(tool: ToolCall): string {
    const text = getMcpText(tool.result)
    if (text) {
      const firstLine = text.split('\n').find((l) => l.trim().length > 0) ?? ''
      return truncate(firstLine, 120)
    }
    const input = unwrapMcpInput(tool.input)
    const search = input.search as string | undefined
    const visibility = input.visibility as string | undefined
    const id = (input.id as string | undefined) ?? (input.name as string | undefined)
    if (id) return id
    if (search) return `search: ${search}`
    if (visibility) return visibility
    return ''
  },

  renderInput(tool: ToolCall) {
    const input = unwrapMcpInput(tool.input)
    const chips: { key: string; label: string }[] = []
    const search = input.search as string | undefined
    const visibility = input.visibility as string | undefined
    const id = input.id as string | undefined
    const name = input.name as string | undefined
    if (search) chips.push({ key: 'search', label: `“${search}”` })
    if (visibility) chips.push({ key: 'visibility', label: visibility })
    if (id) chips.push({ key: 'id', label: id })
    if (name) chips.push({ key: 'name', label: name })

    if (chips.length === 0) return null
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {chips.map((c) => (
          <span
            key={c.key}
            className="px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground text-mini"
          >
            <span className="text-foreground/70">{c.key}</span>
            <span className="ml-1">{c.label}</span>
          </span>
        ))}
      </div>
    )
  },

  renderResult(tool: ToolCall) {
    const text = getMcpText(tool.result)
    if (!text) return null
    if (text.startsWith('Error:')) {
      return <div className="text-tiny text-destructive">{text}</div>
    }
    if (text.startsWith('No ') && text.endsWith(' match.')) {
      return <div className="text-tiny text-muted-foreground italic">{text}</div>
    }
    return (
      <pre className="text-tiny font-mono whitespace-pre-wrap rounded-md bg-muted/40 border border-foreground/[0.06] p-2 max-h-[320px] overflow-y-auto text-foreground/90">
        {text}
      </pre>
    )
  },
}
