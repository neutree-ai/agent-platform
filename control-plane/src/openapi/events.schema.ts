/**
 * OpenAPI doc-mirror for the agent UniversalEvent SSE protocol.
 *
 * Authoritative TS types live in `internal/types/events.ts`. This file
 * is a Zod mirror used purely for OpenAPI component generation — each event
 * variant is registered as a named component so `/docs` can show a proper
 * `oneOf` with expandable per-event shapes.
 *
 * Drift guard: `events.schema.test.ts` asserts `z.infer<...>` stays
 * assignable to the canonical `UniversalEvent` TS type.
 */

import { z } from '@hono/zod-openapi'

// ── Content parts (nested inside UniversalItem) ──────────────────────

const ContentPartSchema = z
  .object({
    type: z.enum(['text', 'tool_call', 'tool_result', 'reasoning', 'status', 'image']),
    text: z.string().optional(),
    call_id: z.string().optional(),
    name: z.string().optional(),
    arguments: z.string().optional(),
    output: z.string().optional(),
    is_error: z.boolean().optional(),
    label: z.string().optional(),
    detail: z.string().optional(),
    data: z.string().optional().openapi({ description: 'Base64 payload (image parts).' }),
    media_type: z.string().optional(),
  })
  .openapi('ContentPart')

const ContentDeltaSchema = z
  .object({
    type: z.enum(['text', 'reasoning']),
    text: z.string(),
  })
  .openapi('ContentDelta')

const UniversalItemSchema = z
  .object({
    item_id: z.string(),
    kind: z.enum(['message', 'tool_call', 'tool_result', 'status']),
    role: z.enum(['user', 'assistant', 'tool']).nullable(),
    status: z.enum(['in_progress', 'completed', 'failed']),
    content: z.array(ContentPartSchema),
    parent_tool_use_id: z.string().nullable().optional().openapi({
      description:
        'If produced inside a sub-agent, the tool_use_id of the Agent call that spawned it.',
    }),
  })
  .openapi('UniversalItem')

const TurnStatsSchema = z
  .object({
    costUsd: z.number(),
    durationMs: z.number(),
    numTurns: z.number(),
    inputTokens: z.number(),
    outputTokens: z.number(),
    cacheReadTokens: z.number(),
    cacheCreationTokens: z.number(),
    contextTokens: z
      .number()
      .openapi({ description: "Last API call's input_tokens ≈ current context size." }),
    contextWindow: z.number().openapi({ description: "Model's context window limit." }),
  })
  .openapi('TurnStats')

// ── Per-event variants ───────────────────────────────────────────────

const baseFields = {
  timestamp: z.number().openapi({ description: 'Epoch milliseconds.' }),
}

const SessionStartedEventSchema = z
  .object({
    type: z.literal('session.started'),
    session_id: z.string(),
    ...baseFields,
  })
  .openapi('SessionStartedEvent')

const SessionEndedEventSchema = z
  .object({
    type: z.literal('session.ended'),
    session_id: z.string().optional(),
    reason: z.enum(['completed', 'error', 'interrupted']),
    stats: TurnStatsSchema.optional(),
    ...baseFields,
  })
  .openapi('SessionEndedEvent')

const ItemStartedEventSchema = z
  .object({
    type: z.literal('item.started'),
    session_id: z.string().optional(),
    item: UniversalItemSchema,
    ...baseFields,
  })
  .openapi('ItemStartedEvent')

const ItemDeltaEventSchema = z
  .object({
    type: z.literal('item.delta'),
    session_id: z.string().optional(),
    item_id: z.string(),
    delta: ContentDeltaSchema,
    ...baseFields,
  })
  .openapi('ItemDeltaEvent')

const ItemCompletedEventSchema = z
  .object({
    type: z.literal('item.completed'),
    session_id: z.string().optional(),
    item: UniversalItemSchema,
    ...baseFields,
  })
  .openapi('ItemCompletedEvent')

const QuestionRequestedEventSchema = z
  .object({
    type: z.literal('question.requested'),
    session_id: z.string().optional(),
    request_id: z.string(),
    questions: z.array(z.unknown()).openapi({
      description: 'Agent-specific question payloads; shape depends on the agent.',
    }),
    ...baseFields,
  })
  .openapi('QuestionRequestedEvent')

const ErrorEventSchema = z
  .object({
    type: z.literal('error'),
    session_id: z.string().optional(),
    message: z.string(),
    code: z.string().optional(),
    ...baseFields,
  })
  .openapi('ErrorEvent')

// ── Discriminated union ──────────────────────────────────────────────

export const UniversalEventSchema = z
  .discriminatedUnion('type', [
    SessionStartedEventSchema,
    SessionEndedEventSchema,
    ItemStartedEventSchema,
    ItemDeltaEventSchema,
    ItemCompletedEventSchema,
    QuestionRequestedEventSchema,
    ErrorEventSchema,
  ])
  .openapi('UniversalEvent', {
    description:
      'Frame payload of the SSE event stream. Each frame is serialized as JSON on a `data: ` line.',
  })

export type UniversalEventInferred = z.infer<typeof UniversalEventSchema>
