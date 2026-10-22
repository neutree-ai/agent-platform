import { describe, expect, it } from 'vitest'
import { calledAgents, describeCall } from './transcript.js'

const call = (callId: string, slug: string) => ({
  type: 'tool_call',
  name: 'mcp__platform__call_agent',
  call_id: callId,
  arguments: JSON.stringify({ slug, mode: 'background', prompt: '…' }),
})
const result = (callId: string, status: string, sessionId: string) => ({
  type: 'tool_result',
  call_id: callId,
  output: JSON.stringify([
    {
      type: 'text',
      text: JSON.stringify({ status, session_id: sessionId, delivery: 'automatic' }),
    },
  ]),
})

describe('calledAgents', () => {
  it('lists the calls that answered running and whose result was not delivered', () => {
    const messages = [
      { blocks: [call('c1', 'helper'), result('c1', 'running', 's1')] },
      { blocks: [call('c2', 'helper'), result('c2', 'running', 's2')] },
      { blocks: [call('c3', 'helper'), result('c3', 'ended', 's3')] },
      {
        blocks: [
          { type: 'text', text: '## helper (@agent/helper) — session_id s1 — ended\nThe answer…' },
        ],
      },
    ]
    expect(calledAgents(messages)).toEqual([{ agent: 'helper', sessionId: 's2' }])
  })
})

describe('describeCall', () => {
  it('names the tool and its subject, on one short line', () => {
    expect(
      describeCall({
        type: 'tool_call',
        name: 'Read',
        arguments: JSON.stringify({ file_path: '/home/agent/notes/2026/plan.md' }),
      }),
    ).toBe('Read …/2026/plan.md')
    expect(
      describeCall({
        type: 'tool_call',
        name: 'mcp__my-app__lookup',
        arguments: JSON.stringify({ id: 42 }),
      }),
    ).toBe('lookup')
    const long = describeCall({
      type: 'tool_call',
      name: 'Bash',
      arguments: JSON.stringify({ command: `node tools/validate.mjs ${'x'.repeat(200)}` }),
    })
    expect(long).toHaveLength(80)
    expect(long.endsWith('…')).toBe(true)
  })
})
