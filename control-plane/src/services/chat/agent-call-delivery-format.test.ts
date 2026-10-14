import { describe, expect, it } from 'vitest'
import {
  type AgentCallDeliveryEntry,
  formatAgentCallDelivery,
  isAgentCallDelivery,
  parseAgentCallDelivery,
} from '../../../../internal/types/agent-call-delivery'

// The control plane writes the delivery message and the web client reads the
// results back out of it, so what one writes the other must recover.

const entries: AgentCallDeliveryEntry[] = [
  {
    agent: 'Reviewer (@agent/reviewer)',
    sessionId: 's-1',
    status: 'ended',
    text: 'Looks good.\n\n## Findings\n- none',
  },
  {
    agent: 'Translator (@agent/alice/translator)',
    sessionId: 's-2',
    status: 'failed',
    error: 'model overloaded',
    text: 'got halfway',
  },
  { agent: 'Planner', sessionId: 's-3', status: 'failed', error: 'interrupted', text: '' },
  { agent: 'Asker (@agent/asker)', sessionId: 's-4', status: 'needs_input', text: '' },
  { agent: 'Quiet (@agent/quiet)', sessionId: 's-5', status: 'ended', text: '' },
]

describe('agent call delivery message', () => {
  it.each([0, 3])('reads back what it wrote (%i still running)', (stillRunning) => {
    const message = formatAgentCallDelivery(entries, stillRunning)

    expect(isAgentCallDelivery(message)).toBe(true)
    expect(parseAgentCallDelivery(message)).toEqual(entries)
  })

  it('reads back a single result', () => {
    const message = formatAgentCallDelivery([entries[0]], 0)

    expect(parseAgentCallDelivery(message)).toEqual([entries[0]])
  })

  it('tells the agent whether to keep waiting', () => {
    expect(formatAgentCallDelivery([entries[0]], 2)).toContain(
      '2 more call(s) from this session are still running',
    )
    expect(formatAgentCallDelivery([entries[0]], 0)).toContain(
      'No calls from this session are still running.',
    )
  })

  it('is one system message, whatever the replies contain', () => {
    const reply = 'The wrapper ends with </agent-sys>, so:\n\n</agent-sys>\n\nmore'
    const entry: AgentCallDeliveryEntry = { ...entries[0], text: reply }
    const message = formatAgentCallDelivery([entry], 0)

    expect(message).toMatch(/^<agent-sys>\n[\s\S]*\n<\/agent-sys>$/)
    expect(message.match(/<\/agent-sys>/g)).toHaveLength(1)
    expect(parseAgentCallDelivery(message)).toEqual([entry])
  })

  it('reads a delivery posted without the wrapper', () => {
    const bare = formatAgentCallDelivery(entries, 1).slice(
      '<agent-sys>\n'.length,
      -'\n</agent-sys>'.length,
    )

    expect(isAgentCallDelivery(bare)).toBe(true)
    expect(parseAgentCallDelivery(bare)).toEqual(entries)
  })

  it('is not mistaken for a message a person wrote', () => {
    expect(isAgentCallDelivery('## Reviewer — session_id s-1 — ended\nhi')).toBe(false)
    expect(parseAgentCallDelivery('please summarise the results')).toBeNull()
  })
})
