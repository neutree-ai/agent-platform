import { describe, expect, it } from 'vitest'
import type { UniversalEvent } from '../../../internal/types/events'
import { MAX_TOOL_OUTPUT_BYTES, capToolResultEvent } from './truncate-tool-output'

function toolResultEvent(output: string): UniversalEvent {
  return {
    type: 'item.completed',
    timestamp: 1,
    session_id: 's1',
    item: {
      item_id: 'i1',
      kind: 'tool_result',
      role: 'tool',
      status: 'completed',
      content: [{ type: 'tool_result', call_id: 'c1', output, is_error: false }],
    },
  }
}

describe('capToolResultEvent', () => {
  it('returns the raw data untouched for an output within the cap', () => {
    const evt = toolResultEvent('ok')
    const raw = JSON.stringify(evt)
    expect(capToolResultEvent(evt, raw)).toBe(raw)
  })

  it('returns the raw data untouched for non-tool_result events', () => {
    const evt: UniversalEvent = {
      type: 'item.completed',
      timestamp: 1,
      item: {
        item_id: 'i2',
        kind: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'text', text: 'x'.repeat(MAX_TOOL_OUTPUT_BYTES * 2) }],
      },
    }
    const raw = JSON.stringify(evt)
    expect(capToolResultEvent(evt, raw)).toBe(raw)
  })

  it('caps an oversized output and keeps the rest of the event', () => {
    const evt = toolResultEvent('日志'.repeat(MAX_TOOL_OUTPUT_BYTES))
    const capped = JSON.parse(capToolResultEvent(evt, JSON.stringify(evt))) as UniversalEvent
    const part = capped.item?.content[0]
    expect(Buffer.byteLength(part?.output ?? '', 'utf8')).toBeLessThan(MAX_TOOL_OUTPUT_BYTES + 200)
    expect(part?.output).toContain('[truncated by cp:')
    expect(part?.call_id).toBe('c1')
    expect(capped.session_id).toBe('s1')
    expect(capped.item?.item_id).toBe('i1')
  })
})
