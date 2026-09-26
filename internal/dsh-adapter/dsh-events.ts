/**
 * Translation layer: DeepSeek Harness SDK notifications → ACP `SessionUpdate`.
 *
 * The platform's event pipeline (`AcpEventTranslator` → UniversalEvent → cp)
 * speaks ACP. dsh speaks two things, and between them everything the pipeline
 * can carry has a home, so this file is a pure mapping and the rest of the
 * adapter stack is reused unchanged:
 *
 *  - the durable session log (`session.event`): tool calls with their
 *    arguments, tool results, per-request usage, turn boundaries;
 *  - live stream frames (`session.stream`): token-level text and reasoning
 *    deltas, which the log does not keep.
 *
 * What is deliberately dropped: `tool-call-delta` (the pipeline has no partial
 * -argument delta; the complete `tool/call` event carries the same arguments a
 * moment later), the stream's `usage` chunk (the same figures settle durably
 * on `assistant/message`, which is what gets counted), and the bookkeeping
 * events (`step/*`, `request/header`, `agent/inbox/*`, `session/title`) that
 * belong to another subsystem.
 */

import type { SessionUpdate } from '@agentclientprotocol/sdk'
import type { DshSessionEvent, DshStreamChunk, DshStreamFrame, DshToolMessage, DshUsage } from './types.js'

/** Accumulated turn facts the bridge reports back on the prompt result. */
export interface DshTurnAccumulator {
  /** Summed across every model request in the turn — tool loops included. */
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  reasoningTokens: number
  /** Last request's input size, the closest thing to "current context fill". */
  lastInputTokens: number
  /** From `request/context`; 0 until the first model request of the turn. */
  contextWindow: number
  /** From `turn/end`; undefined while the turn is still running. */
  end?: { kind: string; message?: string }
}

export function createTurnAccumulator(): DshTurnAccumulator {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    reasoningTokens: 0,
    lastInputTokens: 0,
    contextWindow: 0,
  }
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

/** dsh reports a tool's arguments as a JSON string; the pipeline wants the value. */
function parseArguments(raw: unknown): unknown {
  const text = str(raw)
  if (text === undefined) return raw
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/** Flatten a `tool/result` message into the text the model itself received. */
function toolResultText(message: DshToolMessage): string {
  const parts: string[] = []
  for (const block of message.content ?? []) {
    if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n')
}

/**
 * Stateful per-session translator. One instance per bridge session; the caller
 * feeds it every log event and stream frame of that session and forwards the
 * returned updates.
 */
export class DshEventTranslator {
  /**
   * Tool names by call id. dsh reports the name on `tool/call` but not on the
   * matching `tool/result`, and the pipeline wants a stable name on both.
   */
  private readonly toolNames = new Map<string, string>()

  constructor(private readonly turn: DshTurnAccumulator) {}

  translate(event: DshSessionEvent): SessionUpdate[] {
    switch (event.type) {
      // Each model request settles as exactly one of these, carrying its usage.
      case 'assistant/message':
      case 'assistant/attempt':
        this.accumulate(event.data?.usage as DshUsage | undefined)
        return this.usageUpdate()

      case 'request/context': {
        const window = num(event.data?.contextWindow)
        if (window > 0) this.turn.contextWindow = window
        return []
      }

      case 'tool/call': {
        const callId = str(event.data?.callId)
        if (callId === undefined) return []
        const name = str(event.data?.name) ?? 'tool'
        this.toolNames.set(callId, name)
        // No `kind`: the pipeline reads it in preference to `title` when it
        // picks the name a tool card is dispatched and labelled by, so
        // claiming a kind here would relabel every dsh tool as that kind.
        // The real tool name is what both the renderer registry and the user
        // need.
        return [
          {
            sessionUpdate: 'tool_call',
            toolCallId: callId,
            title: name,
            status: 'in_progress',
            rawInput: parseArguments(event.data?.arguments),
          } as SessionUpdate,
        ]
      }

      case 'tool/result': {
        const message = (event.data?.message ?? {}) as DshToolMessage
        const callId = str(event.data?.callId) ?? str(message.toolCallId)
        if (callId === undefined) return []
        const name = this.toolNames.get(callId)
        this.toolNames.delete(callId)
        return [
          {
            sessionUpdate: 'tool_call_update',
            toolCallId: callId,
            status: message.isError === true ? 'failed' : 'completed',
            ...(name === undefined ? {} : { title: name }),
            rawOutput: toolResultText(message),
          } as SessionUpdate,
        ]
      }

      case 'turn/end': {
        const reason = event.data?.reason as { kind?: unknown; error?: { message?: unknown } } | undefined
        this.turn.end = {
          kind: str(reason?.kind) ?? 'completed',
          ...(str(reason?.error?.message) === undefined ? {} : { message: str(reason?.error?.message) }),
        }
        return this.usageUpdate()
      }

      default:
        return []
    }
  }

  /** Live token deltas. Only text and reasoning have a home in the pipeline. */
  translateStream(frame: DshStreamFrame): SessionUpdate[] {
    if (frame.type !== 'chunk') return []
    const chunk: DshStreamChunk = frame.chunk
    switch (chunk.type) {
      case 'text-delta':
        return [
          { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: chunk.text } } as SessionUpdate,
        ]

      case 'reasoning-delta':
        // Carried for completeness; the platform pipeline currently drops
        // thought chunks, so this surfaces nothing until web renders them.
        return [
          { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: chunk.text } } as SessionUpdate,
        ]

      default:
        return []
    }
  }

  /**
   * dsh settles one usage record per model request, so a tool-loop turn
   * produces several. Summing them is the accurate turn total; taking only the
   * last would undercount exactly the way goose's `PromptResponse.usage` does.
   */
  private accumulate(usage: DshUsage | undefined): void {
    if (usage === undefined) return
    const input = num(usage.inputTokens)
    this.turn.inputTokens += input
    this.turn.outputTokens += num(usage.outputTokens)
    this.turn.cacheReadTokens += num(usage.cacheReadTokens)
    this.turn.reasoningTokens += num(usage.reasoningTokens)
    if (input > 0) this.turn.lastInputTokens = input
  }

  /** The context gauge half of the stats — token totals ride the prompt result. */
  private usageUpdate(): SessionUpdate[] {
    if (this.turn.contextWindow === 0 && this.turn.lastInputTokens === 0) return []
    return [
      {
        sessionUpdate: 'usage_update',
        used: this.turn.lastInputTokens,
        size: this.turn.contextWindow,
      } as unknown as SessionUpdate,
    ]
  }
}
