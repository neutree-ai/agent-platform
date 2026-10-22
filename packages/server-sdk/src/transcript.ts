// Reading an agent transcript (a session's messages, from
// NapClient.listMessages): what each tool call was about, and which other
// agents the conversation called and is still waiting on.

/** The parts of a platform message this reads. */
export interface Block {
  type: string
  name?: string
  call_id?: string
  arguments?: string
  output?: string
  text?: string
}
/** A platform message, as far as this reads it. */
export interface Message {
  created_at?: string
  blocks?: Block[]
}

const LATEST_MAX = 80

// The argument that says the most about a tool call, in the order tools
// usually name their subject.
const SUBJECT_KEYS = ['file_path', 'path', 'command', 'pattern', 'skill', 'query', 'ref', 'url']

/** Text on one line, cut to a status-line length. */
export function oneLine(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > LATEST_MAX ? `${line.slice(0, LATEST_MAX - 1)}…` : line
}

function parseJson(text: string | undefined): unknown {
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

// `mcp__server__tool` and `server__tool` as `tool`.
function toolName(name: string): string {
  return name.split('__').pop() ?? name
}

/** A tool call in a few words: the tool and its subject, e.g. `Read …/src/app.ts`. */
export function describeCall(block: Block): string {
  const name = toolName(block.name ?? 'tool')
  const args = parseJson(block.arguments)
  if (typeof args !== 'object' || args === null) return name
  const values = args as Record<string, unknown>
  const key = SUBJECT_KEYS.find((k) => typeof values[k] === 'string')
  const subject = key ? shortPath(values[key] as string) : ''
  return oneLine(subject ? `${name} ${subject}` : name)
}

// An absolute file path by its last two parts: the file and where it is.
function shortPath(value: string): string {
  if (!/^\/[^\s]+$/.test(value)) return value
  const parts = value.split('/').filter(Boolean)
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : value
}

// A call_agent result is MCP text content holding JSON:
// [{"type":"text","text":"{\"status\":\"running\",\"session_id\":…}"}]
function callResult(output: string | undefined): { status?: string; session_id?: string } {
  const content = parseJson(output)
  const text = Array.isArray(content) ? content.find((part) => part?.type === 'text')?.text : output
  const result = parseJson(text)
  return typeof result === 'object' && result !== null ? (result as never) : {}
}

/**
 * The agents this conversation called whose results are still to come: their
 * call_agent answered "running" or "started", and no result was delivered
 * back. Whether each is still at work can be checked against its session.
 */
export function calledAgents(messages: Message[]): { agent: string; sessionId: string }[] {
  const slugs = new Map<string, string>()
  const called = new Map<string, string>()
  for (const message of messages) {
    for (const block of message.blocks ?? []) {
      if (block.type === 'tool_call' && block.call_id && block.name?.endsWith('call_agent')) {
        const args = parseJson(block.arguments) as { slug?: unknown } | undefined
        if (typeof args?.slug === 'string') slugs.set(block.call_id, args.slug)
        continue
      }
      if (block.type !== 'tool_result' || !block.call_id) continue
      const agent = slugs.get(block.call_id)
      if (!agent) continue
      const { status, session_id } = callResult(block.output)
      if (session_id && (status === 'running' || status === 'started')) {
        called.set(session_id, agent)
      }
    }
  }
  // A delivered result names the session it came from, so those calls are
  // over without asking the platform: "… — session_id <id> — ended".
  const transcript = JSON.stringify(messages)
  return [...called]
    .filter(([sessionId]) => !transcript.includes(`session_id ${sessionId} — ended`))
    .map(([sessionId, agent]) => ({ agent, sessionId }))
}
