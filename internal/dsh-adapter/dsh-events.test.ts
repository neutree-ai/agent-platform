import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTurnAccumulator, DshEventTranslator } from './dsh-events.js'
import type { DshNotification } from './types.js'

/**
 * Recorded from a real dsh runtime driven through the platform's composition
 * and server plugin: one turn with reasoning, a `write` call, a `bash` call,
 * and a final answer — three model requests. Every notification the turn
 * produced is here, log events and stream frames interleaved as they arrived.
 * Replaying it is what catches the wire shape drifting under us — a
 * hand-written event would only ever agree with whatever this file already
 * believes.
 */
function fixtureNotifications(): DshNotification[] {
  const path = join(import.meta.dirname, 'fixtures', 'sdk-notifications.jsonl')
  return readFileSync(path, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as DshNotification)
}

function translateAll() {
  const turn = createTurnAccumulator()
  const translator = new DshEventTranslator(turn)
  const updates = fixtureNotifications().flatMap(n =>
    n.method === 'session.event'
      ? translator.translate(n.params.event)
      : n.method === 'session.stream'
        ? translator.translateStream(n.params.frame)
        : [],
  )
  return { turn, updates }
}

describe('DshEventTranslator', () => {
  it('streams assistant text as message chunks', () => {
    const { updates } = translateAll()
    const chunks = updates.filter(u => u.sessionUpdate === 'agent_message_chunk')
    const text = chunks.map(c => (c as { content: { text: string } }).content.text).join('')
    expect(text).toBe('Hello from fake model.')
  })

  it('carries reasoning separately from the answer', () => {
    const { updates } = translateAll()
    const thoughts = updates.filter(u => u.sessionUpdate === 'agent_thought_chunk')
    expect(thoughts.length).toBeGreaterThan(0)
  })

  it('opens a tool call with its arguments parsed', () => {
    const { updates } = translateAll()
    const calls = updates.filter(u => u.sessionUpdate === 'tool_call')
    expect(calls.map(c => (c as { title: string }).title)).toEqual(['write', 'bash'])
    const write = calls[0] as unknown as { rawInput: Record<string, unknown> }
    // dsh reports arguments as a JSON string; the pipeline renders a value.
    expect(write.rawInput.file_path).toBe('notes.txt')
  })

  it('closes each tool call with its output and keeps the name', () => {
    const { updates } = translateAll()
    const calls = updates.filter(u => u.sessionUpdate === 'tool_call')
    const results = updates.filter(u => u.sessionUpdate === 'tool_call_update') as unknown as {
      status: string
      title: string
      rawOutput: string
      toolCallId: string
    }[]
    expect(results.length).toBe(2)
    // The name arrives on tool/call and must survive onto the result, which
    // carries only the call id.
    expect(results.map(r => r.title)).toEqual(['write', 'bash'])
    expect(results.every(r => r.status === 'completed')).toBe(true)
    expect(results[0].toolCallId).toBe((calls[0] as unknown as { toolCallId: string }).toolCallId)
    expect(results[0].rawOutput).toContain('notes.txt')
    expect(results[1].rawOutput).toContain('hello from dsh')
  })

  it('sums usage across every model request in the turn, once each', () => {
    const { turn } = translateAll()
    // Three requests settle three `assistant/message` events. The stream's own
    // usage chunks repeat the same figures and must not be counted again.
    expect(turn.inputTokens).toBe(3 * turn.lastInputTokens)
    expect(turn.outputTokens).toBeGreaterThan(0)
    expect(turn.cacheReadTokens).toBeGreaterThan(0)
  })

  it('reports the turn outcome and the context gauge', () => {
    const { turn, updates } = translateAll()
    expect(turn.end?.kind).toBe('completed')
    expect(turn.contextWindow).toBe(128_000)
    const gauges = updates.filter(u => u.sessionUpdate === 'usage_update')
    expect(gauges.length).toBeGreaterThan(0)
    const last = gauges.at(-1) as unknown as { used: number; size: number }
    expect(last.size).toBe(128_000)
    expect(last.used).toBe(turn.lastInputTokens)
  })

  it('ignores bookkeeping events rather than inventing updates for them', () => {
    const turn = createTurnAccumulator()
    const translator = new DshEventTranslator(turn)
    for (const type of ['step/start', 'step/end', 'user/message', 'session/title', 'request/header']) {
      expect(translator.translate({ type, seq: 1, time: 0, data: {} })).toEqual([])
    }
  })

  it('marks a failed tool result as an error', () => {
    const turn = createTurnAccumulator()
    const translator = new DshEventTranslator(turn)
    translator.translate({
      type: 'tool/call',
      seq: 1,
      time: 0,
      data: { callId: 'c1', name: 'bash', arguments: '{"command":"false"}' },
    })
    const [update] = translator.translate({
      type: 'tool/result',
      seq: 2,
      time: 0,
      data: {
        message: {
          role: 'tool',
          toolCallId: 'c1',
          content: [{ type: 'text', text: '[exit code: 1]' }],
          isError: true,
        },
      },
    })
    expect((update as unknown as { status: string }).status).toBe('failed')
  })

  it('keeps unparseable tool arguments instead of dropping them', () => {
    const turn = createTurnAccumulator()
    const translator = new DshEventTranslator(turn)
    const [update] = translator.translate({
      type: 'tool/call',
      seq: 1,
      time: 0,
      data: { callId: 'c1', name: 'bash', arguments: '{"command": truncated…' },
    })
    expect((update as unknown as { rawInput: unknown }).rawInput).toBe('{"command": truncated…')
  })
})

describe('through the platform event pipeline', () => {
  /**
   * The translator's output is consumed by `AcpEventTranslator`, which picks
   * the name a tool card is dispatched and labelled by. It prefers a tool
   * call's `kind` over its `title`, so a translator that fills `kind` in with
   * a constant silently relabels every tool — the unit tests above still pass
   * because they read the SessionUpdate, not what the pipeline makes of it.
   */
  it('labels a tool card with the tool the model actually called', async () => {
    const { AcpEventTranslator } = await import('../acp-adapter/universal-events.js')
    const turn = createTurnAccumulator()
    const translator = new DshEventTranslator(turn)
    const pipeline = new AcpEventTranslator('session-1')

    const events = translator.translate({
      type: 'tool/call',
      seq: 1,
      time: 0,
      data: { callId: 'c1', name: 'write', arguments: '{"file_path":"notes.txt"}' },
    })
    const universal = events.flatMap(u => pipeline.translateUpdate(u))
    const started = universal.find(e => e.type === 'item.started')
    const call = started?.item?.content?.[0]

    expect(call?.name).toBe('write')
    expect(call?.call_id).toBe('c1')
  })
})
