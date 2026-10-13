import { transcriptI18n as i18n } from '../../i18n'
import { getSubAgentSessionLink } from '../sub-agent-session-link'
import { type ToolCall, getMcpText, unwrapMcpInput } from '../types'
import type { ToolRendererDef } from '../types'

// cp's result envelope for call_agent and get_agent_result (after MCP text unwrap).
//   ended:       { session_id, status: 'ended',       text }
//   failed:      { session_id, status: 'failed',      error?, text }
//   running:     { session_id, status: 'running',     message? }
//   needs_input: { session_id, status: 'needs_input', message? }
//   started:     { status: 'started',                 message? }   // no session_id yet
type AgentResultStatus = 'ended' | 'failed' | 'running' | 'needs_input' | 'started'

interface CallAgentResult {
  session_id?: string
  status?: AgentResultStatus
  text?: string
  error?: string
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

// The sub-agent's session id. The host can inject a component that turns it
// into a link to that session (resolving the agent + navigating); without one,
// it's plain text.
function SubAgentSessionId({ slug, sessionId }: { slug: string; sessionId: string }) {
  const SessionLink = getSubAgentSessionLink()
  if (SessionLink) return <SessionLink slug={slug} sessionId={sessionId} />
  return (
    <span className="font-mono text-mini text-muted-foreground" title={sessionId}>
      {shortId(sessionId)}
    </span>
  )
}

function StatusChip({ status }: { status: AgentResultStatus | undefined }) {
  switch (status) {
    case 'ended':
      return (
        <span className="rounded bg-success/15 px-1.5 py-0.5 text-mini text-success">done</span>
      )
    case 'failed':
      return (
        <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-mini text-destructive">
          failed
        </span>
      )
    case 'running':
      return <span className="rounded bg-info/15 px-1.5 py-0.5 text-mini text-info">running</span>
    case 'needs_input':
      return (
        <span className="rounded bg-warning/15 px-1.5 py-0.5 text-mini text-warning">
          needs input
        </span>
      )
    case 'started':
      return <span className="rounded bg-info/15 px-1.5 py-0.5 text-mini text-info">started</span>
    default:
      return null
  }
}

/**
 * `slug` is the called agent, which lets the session id link to its session;
 * null when the tool call does not name one (get_agent_result).
 */
function renderAgentResult(tool: ToolCall, slug: string | null) {
  const parsed = parseAgentResult(tool)

  // Not the envelope — show the raw text (error strings, results stored before
  // get_agent_result returned one).
  if (!parsed || typeof parsed !== 'object' || !parsed.status) {
    const text = getMcpText(tool.result)
    if (!text) return null
    return (
      <pre className="whitespace-pre-wrap text-tiny font-mono rounded bg-muted/50 p-1.5 overflow-x-auto max-h-[300px] overflow-y-auto">
        {text}
      </pre>
    )
  }

  const { status, session_id, text, error, message } = parsed
  const note = error ?? message

  return (
    <div className="text-tiny space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusChip status={status} />
        {session_id && slug !== null && <SubAgentSessionId slug={slug} sessionId={session_id} />}
      </div>
      {note ? (
        <div className="rounded border border-dashed bg-muted/30 p-1.5 text-tiny text-muted-foreground">
          {note}
        </div>
      ) : null}
      {text ? (
        <pre className="whitespace-pre-wrap text-tiny font-mono rounded bg-muted/50 p-1.5 overflow-x-auto max-h-[300px] overflow-y-auto">
          {text}
        </pre>
      ) : null}
    </div>
  )
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
    return renderAgentResult(tool, String(unwrapMcpInput(tool.input).slug || ''))
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
    return renderAgentResult(tool, null)
  },
}
