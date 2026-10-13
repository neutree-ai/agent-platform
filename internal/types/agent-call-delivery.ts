// The message that carries `call_agent` results back to the calling session.
//
// The control plane posts it as a user turn, so it is plain text the calling
// agent reads. Clients that show a session — the collaboration timeline, the
// transcript — recognise it by its first line and read the results back out,
// which is why writing and reading it live side by side here.

/** First line of every delivery message. */
const AGENT_CALL_DELIVERY_MARKER =
  '[Automated delivery of call_agent results — written by the platform, not by the user.]'

export type AgentCallDeliveryStatus = 'ended' | 'failed' | 'needs_input'

export interface AgentCallDeliveryEntry {
  /** The called agent as the reader should see it, e.g. `Reviewer (@agent/reviewer)`. */
  agent: string
  /** The called agent's session. */
  sessionId: string
  status: AgentCallDeliveryStatus
  /** The agent's reply, or for `failed` whatever it produced before stopping. */
  text: string
  /** Why the call failed; only for `failed`. */
  error?: string
}

const STATUS_LABEL: Record<AgentCallDeliveryStatus, string> = {
  ended: 'ended',
  failed: 'failed',
  needs_input: 'waiting for user input',
}

const NEEDS_INPUT_NOTE =
  'This agent asked its user a question and is paused until someone answers it in that session. Tell the user. Its result will be delivered here when it finishes.'
const NO_TEXT = '(The agent returned no text response)'
const PARTIAL_OUTPUT_HEAD = 'Output before it stopped:'

function formatEntry(entry: AgentCallDeliveryEntry): string {
  const head = `## ${entry.agent} — session_id ${entry.sessionId} — ${STATUS_LABEL[entry.status]}`
  switch (entry.status) {
    case 'needs_input':
      return `${head}\n${NEEDS_INPUT_NOTE}`
    case 'failed': {
      const partial = entry.text ? `\n\n${PARTIAL_OUTPUT_HEAD}\n${entry.text}` : ''
      return `${head}\nError: ${entry.error ?? 'unknown error'}${partial}`
    }
    case 'ended':
      return `${head}\n${entry.text || NO_TEXT}`
  }
}

/**
 * Build a delivery message. `stillRunning` is how many other calls from the
 * session have not finished, so the agent knows whether to keep waiting.
 */
export function formatAgentCallDelivery(
  entries: AgentCallDeliveryEntry[],
  stillRunning: number,
): string {
  const outstanding =
    stillRunning > 0
      ? `${stillRunning} more call(s) from this session are still running; their results will be delivered the same way. If you need them before you can answer, end your turn and wait.`
      : 'No calls from this session are still running.'
  return [AGENT_CALL_DELIVERY_MARKER, ...entries.map(formatEntry), outstanding].join('\n\n')
}

export function isAgentCallDelivery(text: string): boolean {
  return text.startsWith(AGENT_CALL_DELIVERY_MARKER)
}

const ENTRY_HEAD = /^## (.*) — session_id (\S+) — (ended|failed|waiting for user input)$/

function statusFromLabel(label: string): AgentCallDeliveryStatus {
  switch (label) {
    case 'failed':
      return 'failed'
    case 'waiting for user input':
      return 'needs_input'
    default:
      return 'ended'
  }
}

/**
 * Read the results out of a delivery message; null when the text is not one.
 * A reply may itself contain `## ` lines: only a line with the full entry
 * heading starts a new entry, and the closing line about outstanding calls is
 * dropped from the last one.
 */
export function parseAgentCallDelivery(text: string): AgentCallDeliveryEntry[] | null {
  if (!isAgentCallDelivery(text)) return null
  const lines = text.slice(AGENT_CALL_DELIVERY_MARKER.length).split('\n')

  const entries: { head: RegExpExecArray; body: string[] }[] = []
  for (const line of lines) {
    const head = ENTRY_HEAD.exec(line)
    if (head) {
      entries.push({ head, body: [] })
      continue
    }
    entries[entries.length - 1]?.body.push(line)
  }

  return entries.map(({ head, body }, i) => {
    const status = statusFromLabel(head[3])
    // The last entry is followed by a blank line and the outstanding-calls line.
    const own = i === entries.length - 1 ? body.slice(0, -2) : body
    let content = own.join('\n').replace(/\n+$/, '')
    const entry: AgentCallDeliveryEntry = { agent: head[1], sessionId: head[2], status, text: '' }
    switch (status) {
      case 'needs_input':
        return entry
      case 'failed': {
        const marker = `\n\n${PARTIAL_OUTPUT_HEAD}\n`
        const at = content.indexOf(marker)
        const errorLine = at >= 0 ? content.slice(0, at) : content
        entry.error = errorLine.replace(/^Error: /, '')
        entry.text = at >= 0 ? content.slice(at + marker.length) : ''
        return entry
      }
      case 'ended':
        if (content === NO_TEXT) content = ''
        entry.text = content
        return entry
    }
  })
}
