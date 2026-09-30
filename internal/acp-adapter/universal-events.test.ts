import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SessionNotification } from '@agentclientprotocol/sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UniversalEvent } from '../types/events.js'
import { AcpEventTranslator } from './universal-events.js'

/**
 * Recorded from codex-acp 2.0.1 driving a real model. Each file is every
 * tool-call, message, and usage notification of one turn, in arrival order.
 * codex-acp 2.x omits tool-call fields that did not change since the last
 * report, so a completion often carries `status` alone; replaying real
 * traffic is what shows the translator reads the merged state.
 */
function replay(fixture: string): UniversalEvent[] {
  const path = join(import.meta.dirname, 'fixtures', fixture)
  const translator = new AcpEventTranslator()
  const events: UniversalEvent[] = []
  for (const line of readFileSync(path, 'utf-8').split('\n').filter(Boolean)) {
    const notification = JSON.parse(line) as SessionNotification
    translator.setSessionId(notification.sessionId)
    events.push(...translator.translateUpdate(notification.update))
  }
  return events
}

type ToolResult = { call_id: string; output: string; is_error: boolean }

function toolResults(events: UniversalEvent[]): ToolResult[] {
  return events
    .filter((e) => e.type === 'item.completed' && e.item?.kind === 'tool_result')
    .map((e) => (e as { item: { content: ToolResult[] } }).item.content[0])
}

function completedToolCalls(events: UniversalEvent[]): { name: string; arguments: string }[] {
  return events
    .filter((e) => e.type === 'item.completed' && e.item?.kind === 'tool_call')
    .map((e) => (e as { item: { content: { name: string; arguments: string }[] } }).item.content[0])
}

describe('codex-acp 2.x tool calls', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('rebuilds command output that arrives only as terminal deltas', () => {
    const events = replay('codex-exec.jsonl')
    const calls = completedToolCalls(events)
    const results = toolResults(events)

    expect(calls.map((c) => c.name)).toEqual(['execute', 'read'])
    expect(results).toHaveLength(2)

    const seq = JSON.parse(results[0].output)
    expect(seq.exit_code).toBe(0)
    expect(seq.formatted_output.split('\n').filter(Boolean)).toHaveLength(300)
    expect(results[0].is_error).toBe(false)
  })

  it('keeps the output of a classified command next to its exit code', () => {
    const results = toolResults(replay('codex-exec.jsonl'))
    const ls = JSON.parse(results[1].output)
    expect(ls.exit_code).toBe(2)
    expect(ls.formatted_output).toContain('No such file or directory')
    expect(results[1].is_error).toBe(true)
  })

  it('takes an edit diff from the start when the completion reports status alone', () => {
    const results = toolResults(replay('codex-edit.jsonl'))
    expect(results).toHaveLength(2)
    expect(results[0].output).toBe('+++ /tmp/ws/notes.txt\nhello\n')
    expect(results[1].output).toContain('hello world')
    expect(results[1].output).toContain('--- /tmp/ws/notes.txt')
  })

  it('emits exactly one terminal pair per tool call', () => {
    const events = replay('codex-exec.jsonl')
    const started = events.filter((e) => e.type === 'item.started' && e.item?.kind === 'tool_call')
    expect(started).toHaveLength(2)
    expect(completedToolCalls(events)).toHaveLength(2)
  })
})
