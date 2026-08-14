/**
 * Translation layer: DeepSeek Harness `session.event` → ACP `SessionUpdate`.
 *
 * The platform's event pipeline (`AcpEventTranslator` → UniversalEvent → cp)
 * speaks ACP. dsh speaks its own session log, which is strictly richer — it
 * streams token-level text and reasoning deltas, tool calls with their
 * arguments, per-step usage, and turn boundaries. Everything the pipeline can
 * carry has a home in that vocabulary, so this file is a pure mapping and the
 * rest of the adapter stack is reused unchanged.
 *
 * What is deliberately dropped: `tool-call-delta` (the pipeline has no partial
 * -argument delta; the complete `tool/call` event carries the same arguments a
 * moment later), and the bookkeeping events (`step/*`, `request/*`,
 * `agent/inbox/*`, `assistant/message`, `session/title`) whose content either
 * duplicates the streamed deltas or belongs to another subsystem.
 */

import type { SessionUpdate } from '@agentclientprotocol/sdk'
import type { DshSessionEvent, DshStreamChunk, DshToolResultBlock, DshUsage } from './types.js'

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
function toolResultText(blocks: DshToolResultBlock[]): string {
  const parts: string[] = []
  for (const block of blocks) {
    for (const inner of block.content ?? []) {
      if (inner?.type === 'text' && typeof inner.text === 'string') parts.push(inner.text)
    }
  }
  return parts.join('\n')
}

function toolResultBlocks(event: DshSessionEvent): DshToolResultBlock[] {
  const message = event.data?.message as { content?: unknown } | undefined
  const content = Array.isArray(message?.content) ? message.content : []
  return content.filter((b): b is DshToolResultBlock => (b as DshToolResultBlock)?.type === 'tool-result')
}

/**
 * Stateful per-session translator. One instance per bridge session; the caller
 * feeds it every `session.event` and forwards the returned updates.
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
      case 'assistant/chunk':
        return this.translateChunk(event.data?.chunk as DshStreamChunk | undefined)

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
        return [
          {
            sessionUpdate: 'tool_call',
            toolCallId: callId,
            title: name,
            kind: 'other',
            status: 'in_progress',
            rawInput: parseArguments(event.data?.arguments),
          } as SessionUpdate,
        ]
      }

      case 'tool/result': {
        const blocks = toolResultBlocks(event)
        const callId = str(event.data?.callId) ?? blocks.map(b => b.toolCallId).find(id => id !== undefined)
        if (callId === undefined) return []
        const isError = blocks.some(block => block.isError === true)
        const name = this.toolNames.get(callId)
        this.toolNames.delete(callId)
        return [
          {
            sessionUpdate: 'tool_call_update',
            toolCallId: callId,
            status: isError ? 'failed' : 'completed',
            ...(name === undefined ? {} : { title: name }),
            rawOutput: toolResultText(blocks),
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

  private translateChunk(chunk: DshStreamChunk | undefined): SessionUpdate[] {
    if (chunk === undefined) return []
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

      case 'usage':
        this.accumulate(chunk.usage)
        return this.usageUpdate()

      default:
        return []
    }
  }

  /**
   * dsh emits one usage chunk per model request, so a tool-loop turn produces
   * several. Summing them is the accurate turn total; taking only the last
   * would undercount exactly the way goose's `PromptResponse.usage` does.
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
