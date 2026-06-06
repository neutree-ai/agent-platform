import { describe, expect, it } from 'vitest'
import { type PreferenceRow, resolveChannels } from './resolve'

const E = 'agent.task_done'
const S = 'ws:abc'

function row(event_type: string, scope: string, channel: string, enabled: boolean): PreferenceRow {
  return { event_type, scope, channel, enabled }
}

describe('resolveChannels', () => {
  // --- Basic fallback ---

  it('1. no preference rows → []', () => {
    expect(resolveChannels([], E, S)).toEqual([])
  })

  it('2. global wecom=true → [wecom]', () => {
    const rows = [row('*', '*', 'wecom', true)]
    expect(resolveChannels(rows, E, S)).toEqual(['wecom'])
  })

  it('3. global wecom=false → []', () => {
    const rows = [row('*', '*', 'wecom', false)]
    expect(resolveChannels(rows, E, S)).toEqual([])
  })

  // --- Event type priority ---

  it('4. exact event disables, global enables → []', () => {
    const rows = [row(E, '*', 'wecom', false), row('*', '*', 'wecom', true)]
    expect(resolveChannels(rows, E, S)).toEqual([])
  })

  it('5. exact event enables, global disables → [wecom]', () => {
    const rows = [row(E, '*', 'wecom', true), row('*', '*', 'wecom', false)]
    expect(resolveChannels(rows, E, S)).toEqual(['wecom'])
  })

  // --- Scope priority ---

  it('6. exact scope disables, global enables → []', () => {
    const rows = [row('*', S, 'wecom', false), row('*', '*', 'wecom', true)]
    expect(resolveChannels(rows, E, S)).toEqual([])
  })

  it('7. exact scope enables, global disables → [wecom]', () => {
    const rows = [row('*', S, 'wecom', true), row('*', '*', 'wecom', false)]
    expect(resolveChannels(rows, E, S)).toEqual(['wecom'])
  })

  // --- Event + Scope combination (highest priority) ---

  it('8. exact event+scope disables, everything else enables → []', () => {
    const rows = [
      row(E, S, 'wecom', false),
      row(E, '*', 'wecom', true),
      row('*', S, 'wecom', true),
      row('*', '*', 'wecom', true),
    ]
    expect(resolveChannels(rows, E, S)).toEqual([])
  })

  it('9. exact event+scope enables, everything else disables → [wecom]', () => {
    const rows = [
      row(E, S, 'wecom', true),
      row(E, '*', 'wecom', false),
      row('*', S, 'wecom', false),
      row('*', '*', 'wecom', false),
    ]
    expect(resolveChannels(rows, E, S)).toEqual(['wecom'])
  })

  // --- Multi channel ---

  it('10. different channels resolved independently', () => {
    const rows = [row('*', '*', 'wecom', true), row('*', '*', 'email', false)]
    expect(resolveChannels(rows, E, S)).toEqual(['wecom'])
  })

  it('11. same channel at different levels, mixed with other channels', () => {
    const rows = [
      row('*', '*', 'wecom', true),
      row('*', S, 'wecom', false),
      row('*', '*', 'email', true),
    ]
    expect(resolveChannels(rows, E, S)).toEqual(['email'])
  })

  // --- Edge cases ---

  it('12. all channels explicitly disabled → []', () => {
    const rows = [row('*', '*', 'wecom', false), row('*', '*', 'email', false)]
    expect(resolveChannels(rows, E, S)).toEqual([])
  })

  it('13. querying with scope=* ignores rows with specific scope', () => {
    const rows = [row('*', '*', 'wecom', false), row('*', S, 'wecom', true)]
    // Querying globally — the ws:abc row should NOT match
    expect(resolveChannels(rows, E, '*')).toEqual([])
  })
})
