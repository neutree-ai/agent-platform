import { describe, expectTypeOf, it } from 'vitest'
import type { UniversalEvent } from '../../../internal/types/events'
import { type UniversalEventInferred, UniversalEventSchema } from './events.schema'

/**
 * Drift guard between the canonical TS interface (`UniversalEvent` in
 * @neutree-ai/types) and the Zod doc-mirror registered for OpenAPI. If one side
 * adds or renames a field, this test fails and forces the other to catch
 * up — preserving a single source of truth.
 */
describe('UniversalEventSchema', () => {
  it('inferred type is assignable to the canonical UniversalEvent', () => {
    expectTypeOf<UniversalEventInferred>().toMatchTypeOf<UniversalEvent>()
  })

  it('parses representative frames from each variant', () => {
    const frames: UniversalEvent[] = [
      { type: 'session.started', timestamp: 1, session_id: 's' },
      {
        type: 'session.ended',
        timestamp: 2,
        reason: 'completed',
        stats: {
          costUsd: 0,
          durationMs: 1,
          numTurns: 1,
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          contextTokens: 1,
          contextWindow: 200000,
        },
      },
      {
        type: 'item.started',
        timestamp: 3,
        item: {
          item_id: 'i1',
          kind: 'message',
          role: 'assistant',
          status: 'in_progress',
          content: [],
        },
      },
      {
        type: 'item.delta',
        timestamp: 4,
        item_id: 'i1',
        delta: { type: 'text', text: 'hi' },
      },
      {
        type: 'item.completed',
        timestamp: 5,
        item: {
          item_id: 'i1',
          kind: 'message',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'text', text: 'hi' }],
        },
      },
      {
        type: 'question.requested',
        timestamp: 6,
        request_id: 'r1',
        questions: [{ id: 'q1', prompt: '?' }],
      },
      { type: 'error', timestamp: 7, message: 'boom', code: 'E_X' },
    ]
    for (const f of frames) {
      const r = UniversalEventSchema.safeParse(f)
      if (!r.success) throw new Error(`${f.type}: ${JSON.stringify(r.error.issues)}`)
    }
  })
})
