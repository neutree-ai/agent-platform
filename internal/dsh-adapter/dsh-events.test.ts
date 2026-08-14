import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTurnAccumulator, DshEventTranslator } from './dsh-events.js'
import type { DshSessionEvent } from './types.js'

/**
 * Recorded from a real dsh runtime (deepseek-v4-flash, three tool calls):
 * every event type the turn produced, with the repetitive stream chunks
 * sampled and bulk payloads trimmed. Replaying it is what catches the wire
 * shape drifting under us — a hand-written event would only ever agree with
 * whatever this file already believes.
 */
function fixtureEvents(): DshSessionEvent[] {
  const path = join(import.meta.dirname, 'fixtures', 'session-events.jsonl')
  return readFileSync(path, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as DshSessionEvent)
}

function translateAll() {
  const turn = createTurnAccumulator()
  const translator = new DshEventTranslator(turn)
  const updates = fixtureEvents().flatMap(event => translator.translate(event))
  return { turn, updates }
}

describe('DshEventTranslator', () => {
  it('streams assistant text as message chunks', () => {
    const { updates } = translateAll()
    const chunks = updates.filter(u => u.sessionUpdate === 'agent_message_chunk')
    expect(chunks.length).toBeGreaterThan(0)
    for (const chunk of chunks) {
      expect((chunk as { content: { type: string } }).content.type).toBe('text')
    }
  })

  it('carries reasoning separately from the answer', () => {
    const { updates } = translateAll()
    const thoughts = updates.filter(u => u.sessionUpdate === 'agent_thought_chunk')
    expect(thoughts.length).toBeGreaterThan(0)
  })

  it('opens a tool call with its arguments parsed', () => {
    const { updates } = translateAll()
    const calls = updates.filter(u => u.sessionUpdate === 'tool_call')
    expect(calls.length).toBe(3)
    const write = calls[0] as unknown as { title: string; rawInput: Record<string, unknown> }
    expect(write.title).toBe('write')
    // dsh reports arguments as a JSON string; the pipeline renders a value.
    expect(write.rawInput.file_path).toBe('notes.txt')
  })

  it('closes each tool call with its output and keeps the name', () => {
    const { updates } = translateAll()
    const results = updates.filter(u => u.sessionUpdate === 'tool_call_update')
    expect(results.length).toBe(3)
    const first = results[0] as unknown as {
      status: string
      title: string
      rawOutput: string
      toolCallId: string
    }
    expect(first.status).toBe('completed')
    // The name arrives on tool/call and must survive onto the result, which
    // carries only the call id.
    expect(first.title).toBe('write')
    expect(first.rawOutput).toContain('notes.txt')
    const calls = updates.filter(u => u.sessionUpdate === 'tool_call')
    expect(first.toolCallId).toBe((calls[0] as unknown as { toolCallId: string }).toolCallId)
  })

  it('sums usage across every model request in the turn', () => {
    const { turn } = translateAll()
    // The fixture samples two of the turn's usage records.
    expect(turn.inputTokens).toBeGreaterThan(0)
    expect(turn.outputTokens).toBeGreaterThan(0)
    // Summed, not last-wins: a single request cannot account for the total.
    const lastRequestOnly = turn.lastInputTokens
    expect(turn.inputTokens).toBeGreaterThan(lastRequestOnly)
  })

  it('reports the turn outcome and the context gauge', () => {
    const { turn, updates } = translateAll()
    expect(turn.end?.kind).toBe('completed')
    expect(turn.contextWindow).toBe(1_000_000)
    const gauges = updates.filter(u => u.sessionUpdate === 'usage_update')
    expect(gauges.length).toBeGreaterThan(0)
    const last = gauges.at(-1) as unknown as { used: number; size: number }
    expect(last.size).toBe(1_000_000)
    expect(last.used).toBe(turn.lastInputTokens)
  })

  it('ignores bookkeeping events rather than inventing updates for them', () => {
    const turn = createTurnAccumulator()
    const translator = new DshEventTranslator(turn)
    for (const type of ['step/start', 'step/end', 'user/message', 'session/title']) {
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
          content: [
            {
              type: 'tool-result',
              toolCallId: 'c1',
              content: [{ type: 'text', text: '[exit code: 1]' }],
              isError: true,
            },
          ],
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
