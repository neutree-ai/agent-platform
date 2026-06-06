import i18n from '@/lib/i18n'
import { type ToolCall, type ToolRendererDef, getMcpText, unwrapMcpInput } from '../types'

function safeJsonParse(text: string): Record<string, unknown> | null {
  try {
    const obj = JSON.parse(text)
    return typeof obj === 'object' && obj !== null ? obj : null
  } catch {
    return null
  }
}

function inputName(tool: ToolCall): string {
  return String(unwrapMcpInput(tool.input).name || '')
}

function NameInput({ name }: { name: string }) {
  if (!name) return <div />
  return <div className="text-tiny font-mono text-muted-foreground">{name}</div>
}

function SkillResult({ tool }: { tool: ToolCall }) {
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
  const path = data.path ? String(data.path) : ''
  const message = data.message ? String(data.message) : ''
  return (
    <div className="space-y-1 text-tiny">
      {path && (
        <div className="font-mono text-muted-foreground">
          {i18n.t('components.chat.toolRenderers.skills.labels.path', { value: path })}
        </div>
      )}
      {message && <div className="text-muted-foreground">{message}</div>}
    </div>
  )
}

export const skillCreateDraftRenderer: ToolRendererDef = {
  getPreview(tool) {
    return inputName(tool)
  },
  renderInput(tool) {
    return <NameInput name={inputName(tool)} />
  },
  renderResult(tool) {
    return <SkillResult tool={tool} />
  },
}

export const skillEnterEditRenderer: ToolRendererDef = {
  getPreview(tool) {
    return inputName(tool)
  },
  renderInput(tool) {
    return <NameInput name={inputName(tool)} />
  },
  renderResult(tool) {
    return <SkillResult tool={tool} />
  },
}

export const skillPublishRenderer: ToolRendererDef = {
  getPreview(tool) {
    return inputName(tool)
  },
  renderInput(tool) {
    return <NameInput name={inputName(tool)} />
  },
  renderResult(tool) {
    return <SkillResult tool={tool} />
  },
}
