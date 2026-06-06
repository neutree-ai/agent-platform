import i18n from '@/lib/i18n'
import { type ToolCall, getMcpText, unwrapMcpInput } from '../types'
import type { ToolRendererDef } from '../types'

function safeJsonParse(text: string): Record<string, unknown> | null {
  try {
    const obj = JSON.parse(text)
    return typeof obj === 'object' && obj !== null ? obj : null
  } catch {
    return null
  }
}

export const createBrowserRenderer: ToolRendererDef = {
  getPreview(): string {
    return ''
  },
  renderInput(tool: ToolCall) {
    const input = unwrapMcpInput(tool.input)
    const timeout = input.timeout_seconds as number | undefined
    if (timeout == null) return null
    return (
      <div className="text-tiny text-muted-foreground">
        {i18n.t('components.chat.toolRenderers.browser.timeout', { value: timeout })}
      </div>
    )
  },
  renderResult(tool: ToolCall) {
    const text = getMcpText(tool.result)
    if (!text) return null
    const data = safeJsonParse(text)
    if (!data) return <pre className="whitespace-pre-wrap text-tiny font-mono">{text}</pre>
    const liveViewUrl = String(data.live_view_url || '')
    return (
      <div className="rounded border border-foreground/[0.08] bg-muted/40 p-2 text-tiny space-y-1">
        <div className="flex items-center gap-2">
          <span className="rounded bg-success/20 text-success px-1 py-0.5 text-mini">
            {String(data.status || i18n.t('components.chat.toolRenderers.browser.status.created'))}
          </span>
          <span className="font-mono text-muted-foreground">{String(data.browser_id || '')}</span>
        </div>
        {liveViewUrl && (
          <a
            href={liveViewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-mini text-info hover:underline block"
          >
            {liveViewUrl}
          </a>
        )}
      </div>
    )
  },
}

export const listBrowsersRenderer: ToolRendererDef = {
  getPreview(): string {
    return ''
  },
  renderInput() {
    return <div />
  },
  renderResult(tool: ToolCall) {
    const text = getMcpText(tool.result)
    if (!text) return null
    let items: Record<string, unknown>[]
    try {
      const parsed = JSON.parse(text)
      items = Array.isArray(parsed) ? parsed : []
    } catch {
      return <pre className="whitespace-pre-wrap text-tiny font-mono">{text}</pre>
    }
    if (!items.length)
      return (
        <div className="text-tiny text-muted-foreground">
          {i18n.t('components.chat.toolRenderers.browser.empty.noBrowsers')}
        </div>
      )
    return (
      <div className="space-y-1">
        {items.map((b, i) => (
          <div
            key={i}
            className="rounded border border-foreground/[0.08] bg-muted/40 px-2 py-1 text-tiny font-mono flex items-center gap-2"
          >
            <span className="rounded bg-muted px-1 py-0.5 text-mini text-muted-foreground">
              {String(b.status || '?')}
            </span>
            <span>{String(b.browser_id || '').slice(0, 12)}</span>
          </div>
        ))}
      </div>
    )
  },
}

export const deleteBrowserRenderer: ToolRendererDef = {
  getPreview(tool: ToolCall): string {
    const input = unwrapMcpInput(tool.input)
    return String(input.browser_id || '').slice(0, 8)
  },
  renderInput(tool: ToolCall) {
    const input = unwrapMcpInput(tool.input)
    return (
      <div className="text-tiny font-mono text-muted-foreground">
        {String(input.browser_id || '')}
      </div>
    )
  },
  renderResult(tool: ToolCall) {
    const text = getMcpText(tool.result)
    if (!text) return null
    return <div className="text-tiny text-muted-foreground">{text}</div>
  },
}
