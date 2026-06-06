import i18n from '@/lib/i18n'
import { type ToolCall, getMcpText, unwrapMcpInput } from '../types'
import type { ToolRendererDef } from '../types'

// cp's call_agent result envelope (after MCP text unwrap).
//   ended:    { session_id, status: 'ended',    text }
//   running:  { session_id, status: 'running',  message? }
//   started:  { status: 'started',              message? }   // no session_id yet
interface CallAgentResult {
  session_id?: string
  status?: 'ended' | 'running' | 'started'
  text?: string
  message?: string
}

function parseAgentResult(tool: ToolCall): CallAgentResult | null {
  const text = getMcpText(tool.result)
  if (!text) return null
  try {
    return JSON.parse(text) as CallAgentResult
  } catch {
    return null
  }
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id
}

export const callAgentRenderer: ToolRendererDef = {
  getPreview(tool: ToolCall): string {
    const input = unwrapMcpInput(tool.input)
    const slug = String(input.slug || '')
    const mode = input.mode as string | undefined
    const cont = typeof input.session_id === 'string' && input.session_id.length > 0
    const arrow = cont ? '↩' : '→'
    return mode === 'background'
      ? i18n.t('components.chat.toolRenderers.agent.preview.background', { slug })
      : `${arrow} @${slug}`
  },

  renderInput(tool: ToolCall) {
    const { slug, prompt, mode, session_id } = unwrapMcpInput(tool.input) as {
      slug?: string
      prompt?: string
      mode?: string
      session_id?: string
    }
    const continuation = typeof session_id === 'string' && session_id.length > 0
    return (
      <div className="text-tiny space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded bg-muted px-1.5 py-0.5 text-mini font-mono">@{slug}</span>
          {continuation ? (
            <span
              className="rounded bg-info/15 px-1.5 py-0.5 text-mini text-info"
              title={session_id}
            >
              {i18n.t('components.chat.toolRenderers.agent.input.continue', 'continue {{sid}}', {
                sid: shortId(session_id!),
              })}
            </span>
          ) : (
            <span className="text-mini text-muted-foreground">
              {i18n.t('components.chat.toolRenderers.agent.input.newSession', 'new session')}
            </span>
          )}
          {mode === 'background' && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-mini text-muted-foreground">
              background
            </span>
          )}
        </div>
        {prompt && (
          <pre className="whitespace-pre-wrap rounded bg-muted/50 p-1.5 font-mono overflow-x-auto">
            {prompt}
          </pre>
        )}
      </div>
    )
  },

  renderResult(tool: ToolCall) {
    const parsed = parseAgentResult(tool)

    // Couldn't parse — fall back to raw text (older cp builds, error strings).
    if (!parsed) {
      const text = getMcpText(tool.result)
      if (!text) return null
      return (
        <pre className="whitespace-pre-wrap text-tiny font-mono rounded bg-muted/50 p-1.5 overflow-x-auto max-h-[300px] overflow-y-auto">
          {text}
        </pre>
      )
    }

    const { status, session_id, text, message } = parsed

    const statusChip =
      status === 'ended' ? (
        <span className="rounded bg-success/15 px-1.5 py-0.5 text-mini text-success">done</span>
      ) : status === 'running' ? (
        <span className="rounded bg-info/15 px-1.5 py-0.5 text-mini text-info">running</span>
      ) : status === 'started' ? (
        <span className="rounded bg-info/15 px-1.5 py-0.5 text-mini text-info">started</span>
      ) : null

    return (
      <div className="text-tiny space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {statusChip}
          {session_id && (
            <span className="font-mono text-mini text-muted-foreground" title={session_id}>
              {shortId(session_id)}
            </span>
          )}
        </div>
        {text ? (
          <pre className="whitespace-pre-wrap text-tiny font-mono rounded bg-muted/50 p-1.5 overflow-x-auto max-h-[300px] overflow-y-auto">
            {text}
          </pre>
        ) : message ? (
          <div className="rounded border border-dashed bg-muted/30 p-1.5 text-tiny text-muted-foreground">
            {message}
          </div>
        ) : null}
      </div>
    )
  },
}

export const getAgentResultRenderer: ToolRendererDef = {
  getPreview(tool: ToolCall): string {
    const input = unwrapMcpInput(tool.input)
    return shortId(String(input.session_id || ''))
  },
  renderInput(tool: ToolCall) {
    const input = unwrapMcpInput(tool.input)
    return (
      <div className="text-tiny font-mono text-muted-foreground">
        {String(input.session_id || '')}
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
