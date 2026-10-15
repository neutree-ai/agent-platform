import { describe, expect, it } from 'vitest'
import { describeToolCall, latestStep } from './agent-step'

describe('describeToolCall', () => {
  it('names the tool by its last part and its subject', () => {
    expect(
      describeToolCall({
        name: 'Read',
        arguments: JSON.stringify({ file_path: '/mnt/skills/aoc/SKILL.md' }),
      }),
    ).toBe('Read …/aoc/SKILL.md')
    expect(describeToolCall({ name: 'mcp__ops__ops_call', arguments: '{"ref":"x.json"}' })).toBe(
      'ops_call x.json',
    )
  })

  it('falls back to the tool name, and keeps to one short line', () => {
    expect(describeToolCall({ name: 'TodoWrite', arguments: 'not json' })).toBe('TodoWrite')
    const long = describeToolCall({
      name: 'Bash',
      arguments: JSON.stringify({ command: `echo ${'x'.repeat(200)}\nls` }),
    })
    expect(long.length).toBe(80)
    expect(long.endsWith('…')).toBe(true)
    expect(long.includes('\n')).toBe(false)
  })
})

describe('latestStep', () => {
  it('is the last tool call among the blocks', () => {
    const blocks = JSON.stringify([
      { type: 'tool_call', name: 'Read', arguments: '{"file_path":"a"}' },
      { type: 'text', text: 'thinking' },
      { type: 'tool_call', name: 'Grep', arguments: '{"pattern":"vm"}' },
      { type: 'tool_result', output: 'x' },
    ])
    expect(latestStep(blocks)).toBe('Grep vm')
  })

  it('is null without a tool call, or without blocks', () => {
    expect(latestStep('[{"type":"text","text":"hi"}]')).toBeNull()
    expect(latestStep(null)).toBeNull()
    expect(latestStep('garbage')).toBeNull()
  })
})
