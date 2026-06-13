import { transcriptI18n as i18n } from '../../i18n'
import { type ToolRendererDef, getMcpText, unwrapMcpInput } from '../types'

function safeJsonParse(text: string): Record<string, unknown> | null {
  try {
    const obj = JSON.parse(text)
    return typeof obj === 'object' && obj !== null ? obj : null
  } catch {
    return null
  }
}

function ErrorOrJson({
  text,
  render,
}: {
  text: string
  render: (data: Record<string, unknown>) => React.ReactNode
}) {
  if (text.startsWith('Error:')) {
    return (
      <div className="rounded bg-destructive/20 text-destructive px-1.5 py-1 text-tiny font-mono whitespace-pre-wrap">
        {text}
      </div>
    )
  }
  const data = safeJsonParse(text)
  if (!data) return <div className="text-tiny text-muted-foreground">{text}</div>
  return <>{render(data)}</>
}

export const shareFolderRenderer: ToolRendererDef = {
  getPreview(tool) {
    return String(unwrapMcpInput(tool.input).name || '')
  },
  renderInput(tool) {
    const name = String(unwrapMcpInput(tool.input).name || '')
    if (!name) return <div />
    return <div className="text-tiny font-mono text-muted-foreground">{name}</div>
  },
  renderResult(tool) {
    const text = getMcpText(tool.result)
    if (!text) return null
    return (
      <ErrorOrJson
        text={text}
        render={(data) => (
          <div className="text-tiny font-mono text-muted-foreground">{String(data.path || '')}</div>
        )}
      />
    )
  },
}

export const grantAccessRenderer: ToolRendererDef = {
  getPreview(tool) {
    const input = unwrapMcpInput(tool.input)
    const name = String(input.name || '')
    const slug = String(input.slug || '')
    return slug ? `${name} → @${slug}` : name
  },
  renderInput(tool) {
    const input = unwrapMcpInput(tool.input)
    const name = String(input.name || '')
    const slug = String(input.slug || '')
    const readonly = input.readonly !== false
    return (
      <div className="text-tiny space-y-0.5">
        <div className="font-mono text-muted-foreground">{name}</div>
        <div className="flex items-center gap-1.5">
          <span className="font-mono">@{slug}</span>
          <span className="rounded bg-muted/50 text-muted-foreground px-1 py-0.5 text-mini">
            {readonly
              ? i18n.t('components.chat.toolRenderers.afs.labels.readOnly')
              : i18n.t('components.chat.toolRenderers.afs.labels.readWrite')}
          </span>
        </div>
      </div>
    )
  },
  renderResult(tool) {
    const text = getMcpText(tool.result)
    if (!text) return null
    return (
      <ErrorOrJson
        text={text}
        render={(data) => (
          <div className="text-tiny space-y-0.5">
            <div className="font-mono text-muted-foreground">{String(data.path || '')}</div>
            <div className="flex items-center gap-1.5">
              <span className="font-mono">@{String(data.target || '')}</span>
              <span className="rounded bg-muted/50 text-muted-foreground px-1 py-0.5 text-mini">
                {data.readonly === false
                  ? i18n.t('components.chat.toolRenderers.afs.labels.readWrite')
                  : i18n.t('components.chat.toolRenderers.afs.labels.readOnly')}
              </span>
            </div>
          </div>
        )}
      />
    )
  },
}

export const unshareFromAllRenderer: ToolRendererDef = {
  getPreview(tool) {
    return String(unwrapMcpInput(tool.input).name || '')
  },
  renderInput(tool) {
    const name = String(unwrapMcpInput(tool.input).name || '')
    if (!name) return <div />
    return <div className="text-tiny font-mono text-muted-foreground">{name}</div>
  },
  renderResult(tool) {
    const text = getMcpText(tool.result)
    if (!text) return null
    return (
      <ErrorOrJson
        text={text}
        render={(data) => {
          const members = Number(data.members || 0)
          return (
            <div className="text-tiny text-muted-foreground space-y-0.5">
              <div className="font-mono">{String(data.revoked || '')}</div>
              <div>
                {i18n.t('components.chat.toolRenderers.afs.labels.membersAffected', {
                  count: members,
                })}
              </div>
            </div>
          )
        }}
      />
    )
  },
}
