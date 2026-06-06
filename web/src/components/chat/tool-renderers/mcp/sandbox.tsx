import i18n from '@/lib/i18n'
import { type ToolCall, getMcpText, truncate, unwrapMcpInput } from '../types'
import type { ToolRendererDef } from '../types'

function safeJsonParse(text: string): Record<string, unknown> | null {
  try {
    const obj = JSON.parse(text)
    return typeof obj === 'object' && obj !== null ? obj : null
  } catch {
    return null
  }
}

export const createSandboxRenderer: ToolRendererDef = {
  getPreview(tool: ToolCall): string {
    const input = unwrapMcpInput(tool.input)
    return String(input.image || '')
  },
  renderInput(tool: ToolCall) {
    const { image, resource, timeout_seconds } = unwrapMcpInput(tool.input) as {
      image?: string
      resource?: { cpu?: string; memory?: string }
      timeout_seconds?: number
    }
    return (
      <div className="text-tiny space-y-1">
        <div className="font-mono">{image}</div>
        {resource && (
          <div className="text-mini text-muted-foreground">
            {resource.cpu && (
              <span>
                {i18n.t('components.chat.toolRenderers.sandbox.labels.cpu', {
                  value: resource.cpu,
                })}{' '}
              </span>
            )}
            {resource.memory && (
              <span>
                {i18n.t('components.chat.toolRenderers.sandbox.labels.memory', {
                  value: resource.memory,
                })}
              </span>
            )}
          </div>
        )}
        {timeout_seconds != null && (
          <div className="text-mini text-muted-foreground">
            {i18n.t('components.chat.toolRenderers.sandbox.labels.timeout', {
              value: timeout_seconds,
            })}
          </div>
        )}
      </div>
    )
  },
  renderResult(tool: ToolCall) {
    const text = getMcpText(tool.result)
    if (!text) return null
    const data = safeJsonParse(text)
    if (!data) return <pre className="whitespace-pre-wrap text-tiny font-mono">{text}</pre>
    return (
      <div className="rounded border border-foreground/[0.08] bg-muted/40 p-2 text-tiny space-y-1">
        <div className="flex items-center gap-2">
          <span className="rounded bg-success/20 text-success px-1 py-0.5 text-mini">
            {typeof data.status === 'object' && data.status !== null
              ? String(
                  (data.status as Record<string, unknown>).state ||
                    i18n.t('components.chat.toolRenderers.sandbox.status.created'),
                )
              : String(
                  data.status || i18n.t('components.chat.toolRenderers.sandbox.status.created'),
                )}
          </span>
          <span className="font-mono text-muted-foreground">{String(data.sandbox_id || '')}</span>
        </div>
        {data.image ? (
          <div className="text-mini text-muted-foreground font-mono">{String(data.image)}</div>
        ) : null}
        {data.expires_at ? (
          <div className="text-mini text-muted-foreground">
            {i18n.t('components.chat.toolRenderers.sandbox.labels.expires', {
              value: String(data.expires_at),
            })}
          </div>
        ) : null}
      </div>
    )
  },
}

export const listSandboxesRenderer: ToolRendererDef = {
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
          {i18n.t('components.chat.toolRenderers.sandbox.empty.noSandboxes')}
        </div>
      )
    return (
      <div className="space-y-1">
        {items.map((s, i) => (
          <div
            key={i}
            className="rounded border border-foreground/[0.08] bg-muted/40 px-2 py-1 text-tiny font-mono flex items-center gap-2"
          >
            <span className="rounded bg-muted px-1 py-0.5 text-mini text-muted-foreground">
              {String(s.status || '?')}
            </span>
            <span>{String(s.sandbox_id || '').slice(0, 12)}</span>
            {s.image ? <span className="text-muted-foreground">{String(s.image)}</span> : null}
          </div>
        ))}
      </div>
    )
  },
}

export const sandboxRunCommandRenderer: ToolRendererDef = {
  getPreview(tool: ToolCall): string {
    const input = unwrapMcpInput(tool.input)
    return truncate(String(input.command || ''), 80)
  },
  renderInput(tool: ToolCall) {
    const { command, sandbox_id, cwd } = unwrapMcpInput(tool.input) as Record<
      string,
      string | undefined
    >
    if (!command) return null
    return (
      <div>
        <div className="text-xs text-muted-foreground mb-1">
          {i18n.t('components.chat.toolRenderers.sandbox.labels.command')}
        </div>
        <pre className="text-tiny bg-muted border border-foreground/[0.08] p-2 rounded-md overflow-x-auto font-mono">
          {command}
        </pre>
        {(sandbox_id || cwd) && (
          <div className="text-mini text-muted-foreground mt-1">
            {cwd ? i18n.t('components.chat.toolRenderers.sandbox.labels.cwd', { value: cwd }) : ''}
            {cwd && sandbox_id ? ' · ' : ''}
            {sandbox_id
              ? i18n.t('components.chat.toolRenderers.sandbox.labels.sandbox', {
                  value: `${sandbox_id.slice(0, 8)}...`,
                })
              : ''}
          </div>
        )}
      </div>
    )
  },
  renderResult(tool: ToolCall) {
    const text = getMcpText(tool.result)
    if (!text) return null
    const data = safeJsonParse(text)
    if (!data) return <pre className="whitespace-pre-wrap text-tiny font-mono">{text}</pre>
    const stdout = String(data.stdout || '')
    const stderr = String(data.stderr || '')
    const exitCode = data.exit_code as number | undefined
    return (
      <div className="text-tiny space-y-1">
        {exitCode != null && (
          <div className="text-mini">
            <span
              className={`rounded px-1 py-0.5 font-mono ${
                exitCode === 0 ? 'bg-success/20 text-success' : 'bg-destructive/20 text-destructive'
              }`}
            >
              {i18n.t('components.chat.toolRenderers.sandbox.labels.exitCode', {
                value: exitCode,
              })}
            </span>
          </div>
        )}
        {stdout && (
          <pre className="whitespace-pre-wrap rounded bg-muted/50 p-1.5 font-mono overflow-x-auto max-h-[200px] overflow-y-auto">
            {stdout}
          </pre>
        )}
        {stderr && (
          <pre className="whitespace-pre-wrap rounded bg-destructive/10 p-1.5 font-mono overflow-x-auto max-h-[200px] overflow-y-auto text-destructive">
            {stderr}
          </pre>
        )}
      </div>
    )
  },
}

export const sandboxReadFileRenderer: ToolRendererDef = {
  getPreview(tool: ToolCall): string {
    const input = unwrapMcpInput(tool.input)
    return String(input.path || '')
  },
  renderInput(tool: ToolCall) {
    const { path, sandbox_id } = unwrapMcpInput(tool.input) as Record<string, string | undefined>
    return (
      <div className="text-tiny font-mono">
        <span className="text-muted-foreground">{sandbox_id} </span>
        {path}
      </div>
    )
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

export const sandboxWriteFilesRenderer: ToolRendererDef = {
  getPreview(tool: ToolCall): string {
    const input = unwrapMcpInput(tool.input)
    const files = input.files as Array<{ path: string }> | undefined
    if (Array.isArray(files))
      return i18n.t('components.chat.toolRenderers.sandbox.preview.files', { count: files.length })
    return ''
  },
  renderInput(tool: ToolCall) {
    const input = unwrapMcpInput(tool.input)
    const files = input.files as Array<{ path: string; content: string }> | undefined
    if (!Array.isArray(files) || !files.length) return null
    return (
      <div className="space-y-1">
        {files.map((f, i) => (
          <div key={i} className="text-tiny font-mono text-muted-foreground">
            {f.path}
          </div>
        ))}
      </div>
    )
  },
  renderResult(tool: ToolCall) {
    const text = getMcpText(tool.result)
    if (!text) return null
    return <div className="text-tiny text-muted-foreground">{text}</div>
  },
}

export const sandboxGetPreviewUrlRenderer: ToolRendererDef = {
  getPreview(tool: ToolCall): string {
    const input = unwrapMcpInput(tool.input)
    return `:${input.port || ''}`
  },
  renderInput(tool: ToolCall) {
    const { sandbox_id, port } = unwrapMcpInput(tool.input) as Record<
      string,
      string | number | undefined
    >
    return (
      <div className="text-tiny font-mono">
        <span className="text-muted-foreground">{sandbox_id} </span>:{port}
      </div>
    )
  },
  renderResult(tool: ToolCall) {
    const text = getMcpText(tool.result)
    if (!text) return null
    const data = safeJsonParse(text)
    if (!data) return <pre className="whitespace-pre-wrap text-tiny font-mono">{text}</pre>
    const url = String(data.url || '')
    return (
      <div className="text-tiny">
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-info hover:underline"
          >
            {url}
          </a>
        ) : (
          <span className="font-mono text-muted-foreground">
            {i18n.t('components.chat.toolRenderers.sandbox.empty.noUrl')}
          </span>
        )}
      </div>
    )
  },
}

export const killSandboxRenderer: ToolRendererDef = {
  getPreview(tool: ToolCall): string {
    const input = unwrapMcpInput(tool.input)
    return String(input.sandbox_id || '').slice(0, 8)
  },
  renderInput(tool: ToolCall) {
    const input = unwrapMcpInput(tool.input)
    return (
      <div className="text-tiny font-mono text-muted-foreground">
        {String(input.sandbox_id || '')}
      </div>
    )
  },
  renderResult(tool: ToolCall) {
    const text = getMcpText(tool.result)
    if (!text) return null
    return <div className="text-tiny text-muted-foreground">{text}</div>
  },
}
