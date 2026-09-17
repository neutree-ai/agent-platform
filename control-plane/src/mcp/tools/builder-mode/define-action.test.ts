import { describe, expect, it } from 'vitest'
import { MAX_TOOL_OUTPUT_BYTES } from '../../../lib/truncate-tool-output'
import { buildProposeEnvelope } from './define-action'

const base = { request_id: 'req-1', kind: 'builder.global.prompt.update', label: 'Update prompt' }

describe('buildProposeEnvelope', () => {
  it('embeds the payload when the result fits the tool output cap', () => {
    const env = JSON.parse(buildProposeEnvelope({ ...base, payload: { id: 'p1', content: 'hi' } }))
    expect(env).toEqual({ ...base, payload: { id: 'p1', content: 'hi' }, status: 'pending' })
  })

  it('drops the payload when the wrapped result would exceed the cap', () => {
    // CJK + newlines: raw size under the cap, wrapped size over it.
    const content = '翻译规则\n'.repeat(2300)
    const out = buildProposeEnvelope({ ...base, payload: { id: 'p1', content } })
    expect(Buffer.byteLength(content)).toBeLessThan(MAX_TOOL_OUTPUT_BYTES)
    expect(Buffer.byteLength(JSON.stringify(out))).toBeLessThan(MAX_TOOL_OUTPUT_BYTES)
    expect(JSON.parse(out)).toEqual({ ...base, status: 'pending' })
  })
})
