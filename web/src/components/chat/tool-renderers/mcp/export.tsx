import i18n from '@/lib/i18n'
import { type ToolRendererDef, getMcpText, unwrapMcpInput } from '../types'

function safeJsonParse(text: string): Record<string, unknown> | null {
  try {
    const obj = JSON.parse(text)
    return typeof obj === 'object' && obj !== null ? obj : null
  } catch {
    return null
  }
}

export const exportFileUrlRenderer: ToolRendererDef = {
  getPreview(tool) {
    const input = unwrapMcpInput(tool.input)
    const path = String(input.path || '')
    const basename = path.split('/').pop() || ''
    return basename
  },
  renderInput(tool) {
    const input = unwrapMcpInput(tool.input)
    const path = String(input.path || '')
    const ttl = input.ttl_seconds as number | undefined
    return (
      <div className="text-tiny space-y-0.5">
        <div className="font-mono text-muted-foreground">{path}</div>
        {ttl != null && (
          <div className="text-muted-foreground">
            {i18n.t('components.chat.toolRenderers.exportFileUrl.labels.ttl', { value: ttl })}
          </div>
        )}
      </div>
    )
  },
  renderResult(tool) {
    const text = getMcpText(tool.result)
    if (!text) return null
    if (text.startsWith('Error:')) {
      return (
        <div className="rounded bg-destructive/20 text-destructive px-1.5 py-1 text-tiny font-mono whitespace-pre-wrap">
          {text}
        </div>
      )
    }
    const data = safeJsonParse(text)
    if (!data) return <div className="text-tiny text-muted-foreground">{text}</div>
    const url = String(data.url || '')
    const expiresAt = data.expires_at ? String(data.expires_at) : ''
    return (
      <div className="rounded border border-foreground/[0.08] bg-muted/40 p-2 text-tiny space-y-1">
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-mini text-info hover:underline block break-all"
          >
            {url}
          </a>
        )}
        {expiresAt && (
          <div className="text-muted-foreground text-mini">
            {i18n.t('components.chat.toolRenderers.exportFileUrl.labels.expires', {
              value: expiresAt,
            })}
          </div>
        )}
      </div>
    )
  },
}
