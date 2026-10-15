// What an agent is doing, in one line: the last tool it called and on what,
// read from the blocks of its latest message. Used to show the progress of a
// called agent to whoever waits on it.

/** The parts of a stored message block this reads. */
interface StepBlock {
  type?: string
  name?: string
  arguments?: string
}

const STEP_MAX = 80

// The argument that says the most about a tool call, in the order tools
// usually name their subject.
const SUBJECT_KEYS = ['file_path', 'path', 'command', 'pattern', 'skill', 'query', 'ref', 'url']

function parseJson(text: string | undefined): unknown {
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function oneLine(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > STEP_MAX ? `${line.slice(0, STEP_MAX - 1)}…` : line
}

// An absolute file path by its last two parts: the file and where it is.
function shortPath(value: string): string {
  if (!/^\/[^\s]+$/.test(value)) return value
  const parts = value.split('/').filter(Boolean)
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : value
}

/** A tool call as "Tool subject": `mcp__server__tool` reads as `tool`. */
export function describeToolCall(block: StepBlock): string {
  const name = (block.name ?? 'tool').split('__').pop() ?? 'tool'
  const args = parseJson(block.arguments)
  if (typeof args !== 'object' || args === null) return name
  const values = args as Record<string, unknown>
  const key = SUBJECT_KEYS.find((k) => typeof values[k] === 'string')
  const subject = key ? shortPath(values[key] as string) : ''
  return oneLine(subject ? `${name} ${subject}` : name)
}

/** The latest step in a message's stored blocks (a JSON array), or null. */
export function latestStep(blocksJson: string | null | undefined): string | null {
  const blocks = parseJson(blocksJson ?? undefined)
  if (!Array.isArray(blocks)) return null
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i] as StepBlock
    if (block?.type === 'tool_call') return describeToolCall(block)
  }
  return null
}
