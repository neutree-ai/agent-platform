/**
 * Translation layer: Claude Agent SDK messages → UniversalEvent protocol.
 *
 * The agent server calls these helpers to convert raw SDK stream messages
 * into the standardised UniversalEvent SSE format consumed by the
 * control-plane interceptor and web frontend.
 */

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type {
  AskUserRequest,
  ContentDelta,
  ContentPart,
  TurnStats,
  UniversalEvent,
  UniversalItem,
} from '../../../internal/types/events.js'

export type { ContentDelta, ContentPart, UniversalEvent, UniversalItem }

// ── Helpers ──

function ts(): number {
  return Date.now()
}

let _itemCounter = 0
function nextItemId(): string {
  return `item_${Date.now()}_${++_itemCounter}`
}

// ── Translator state ──

/**
 * Stateful translator that converts a stream of SDK messages into
 * UniversalEvent objects. One instance per chat turn.
 */
export class UniversalEventTranslator {
  private sessionId: string | undefined
  /** Current assistant message item (accumulates text across stream deltas) */
  private currentMessageItem: UniversalItem | null = null

  constructor(sessionId?: string) {
    this.sessionId = sessionId
  }

  setSessionId(id: string) {
    this.sessionId = id
  }

  // ── Session lifecycle ──

  sessionStarted(sessionId: string): UniversalEvent {
    this.sessionId = sessionId
    return { type: 'session.started', timestamp: ts(), session_id: sessionId }
  }

  sessionEnded(reason: 'completed' | 'error' | 'interrupted', stats?: TurnStats): UniversalEvent {
    return {
      type: 'session.ended',
      timestamp: ts(),
      session_id: this.sessionId,
      reason,
      stats,
    }
  }

  // ── Question / error ──

  questionRequested(request: AskUserRequest): UniversalEvent {
    return {
      type: 'question.requested',
      timestamp: ts(),
      session_id: this.sessionId,
      request_id: request.requestId,
      questions: request.questions,
    }
  }

  error(message: string, code?: string): UniversalEvent {
    return {
      type: 'error',
      timestamp: ts(),
      session_id: this.sessionId,
      message,
      code,
    }
  }

  // ── SDK message → UniversalEvent[] ──

  /**
   * Translate a single SDK message into zero or more UniversalEvents.
   * Most SDK messages produce one event; assistant messages with mixed
   * content (text + tool_use blocks) produce multiple.
   */
  translate(msg: SDKMessage): UniversalEvent[] {
    const events: UniversalEvent[] = []

    // Extract parent_tool_use_id from SDK message (non-null means inside a sub-agent)
    const parentToolUseId: string | null =
      'parent_tool_use_id' in msg ? ((msg as any).parent_tool_use_id ?? null) : null

    /** Attach parent_tool_use_id to an item when it's non-null */
    const withParent = (item: UniversalItem): UniversalItem =>
      parentToolUseId ? { ...item, parent_tool_use_id: parentToolUseId } : item

    // ── Streaming deltas (real-time text) ──
    if (msg.type === 'stream_event' && 'event' in msg) {
      const event = (msg as any).event
      if (!event) return events

      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        // Ensure we have a current message item
        if (!this.currentMessageItem) {
          this.currentMessageItem = {
            item_id: nextItemId(),
            kind: 'message',
            role: 'assistant',
            status: 'in_progress',
            content: [],
            ...(parentToolUseId ? { parent_tool_use_id: parentToolUseId } : {}),
          }
          events.push({
            type: 'item.started',
            timestamp: ts(),
            session_id: this.sessionId,
            item: { ...this.currentMessageItem },
          })
        }

        events.push({
          type: 'item.delta',
          timestamp: ts(),
          session_id: this.sessionId,
          item_id: this.currentMessageItem.item_id,
          delta: { type: 'text', text: event.delta.text },
        })
      } else if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
        // Tool use starting — emit as a new tool_call item (started, in_progress)
        const cb = event.content_block
        const toolItem: UniversalItem = withParent({
          item_id: nextItemId(),
          kind: 'tool_call',
          role: 'assistant',
          status: 'in_progress',
          content: [
            {
              type: 'tool_call',
              call_id: cb.id,
              name: cb.name,
              arguments: '{}',
            },
          ],
        })
        events.push({
          type: 'item.started',
          timestamp: ts(),
          session_id: this.sessionId,
          item: toolItem,
        })
      }

      return events
    }

    // ── Complete assistant message ──
    if (msg.type === 'assistant' && 'message' in msg) {
      const content = (msg as any).message?.content
      if (!Array.isArray(content)) return events

      for (const block of content) {
        if (block.type === 'text') {
          // Create a message item if none exists (e.g. API error with no prior stream events)
          if (!this.currentMessageItem) {
            this.currentMessageItem = withParent({
              item_id: nextItemId(),
              kind: 'message',
              role: 'assistant',
              status: 'in_progress',
              content: [],
            })
            events.push({
              type: 'item.started',
              timestamp: ts(),
              session_id: this.sessionId,
              item: { ...this.currentMessageItem },
            })
          }
          // Finalize the message item with complete text
          this.currentMessageItem.status = 'completed'
          this.currentMessageItem.content = [{ type: 'text', text: block.text }]
          events.push({
            type: 'item.completed',
            timestamp: ts(),
            session_id: this.sessionId,
            item: { ...this.currentMessageItem },
          })
          this.currentMessageItem = null
        } else if (block.type === 'tool_use') {
          // Finalize the text message if pending
          if (this.currentMessageItem) {
            this.currentMessageItem.status = 'completed'
            events.push({
              type: 'item.completed',
              timestamp: ts(),
              session_id: this.sessionId,
              item: { ...this.currentMessageItem },
            })
            this.currentMessageItem = null
          }

          // Emit completed tool_call item with full input
          const toolItem: UniversalItem = withParent({
            item_id: nextItemId(),
            kind: 'tool_call',
            role: 'assistant',
            status: 'completed',
            content: [
              {
                type: 'tool_call',
                call_id: block.id,
                name: block.name,
                arguments:
                  typeof block.input === 'string' ? block.input : JSON.stringify(block.input),
              },
            ],
          })
          events.push({
            type: 'item.completed',
            timestamp: ts(),
            session_id: this.sessionId,
            item: toolItem,
          })
        }
      }

      return events
    }

    // ── Tool results (user messages containing tool_result blocks) ──
    if (msg.type === 'user' && 'message' in msg) {
      const content = (msg as any).message?.content

      // Handle stderr messages (e.g. /compact failure) — surface as status error
      if (typeof content === 'string') {
        const stderrMatch = content.match(
          /<local-command-stderr>([\s\S]*?)<\/local-command-stderr>/,
        )
        if (stderrMatch) {
          const errorText = stderrMatch[1].trim()
          const statusItem: UniversalItem = {
            item_id: nextItemId(),
            kind: 'status',
            role: null,
            status: 'failed',
            content: [{ type: 'status', label: 'Command failed', detail: errorText }],
          }
          events.push({
            type: 'item.completed',
            timestamp: ts(),
            session_id: this.sessionId,
            item: statusItem,
          })
        }
        return events
      }

      if (!Array.isArray(content)) return events

      for (const block of content) {
        if (block.type === 'tool_result') {
          const resultItem: UniversalItem = withParent({
            item_id: nextItemId(),
            kind: 'tool_result',
            role: 'tool',
            status: block.is_error ? 'failed' : 'completed',
            content: [
              {
                type: 'tool_result',
                call_id: block.tool_use_id,
                output:
                  typeof block.content === 'string'
                    ? block.content
                    : JSON.stringify(block.content ?? ''),
                is_error: block.is_error ?? false,
              },
            ],
          })
          events.push({
            type: 'item.completed',
            timestamp: ts(),
            session_id: this.sessionId,
            item: resultItem,
          })
        }
      }

      // After tool results, a new assistant turn begins
      this.currentMessageItem = null

      return events
    }

    // ── Compact boundary (after /compact or auto-compact) ──
    if (msg.type === 'system' && 'subtype' in msg && (msg as any).subtype === 'compact_boundary') {
      const meta = (msg as any).compact_metadata
      const label = meta?.trigger === 'manual' ? 'Conversation compacted' : 'Auto-compacted'
      const detail = meta?.pre_tokens
        ? `Freed context from ${meta.pre_tokens.toLocaleString()} tokens`
        : undefined
      const statusItem: UniversalItem = {
        item_id: nextItemId(),
        kind: 'status',
        role: null,
        status: 'completed',
        content: [{ type: 'status', label, detail }],
      }
      events.push({
        type: 'item.completed',
        timestamp: ts(),
        session_id: this.sessionId,
        item: statusItem,
      })
      return events
    }

    // ── Result message (turn complete) ──
    if (msg.type === 'result') {
      // Finalize any in-progress message
      if (this.currentMessageItem) {
        this.currentMessageItem.status = 'completed'
        events.push({
          type: 'item.completed',
          timestamp: ts(),
          session_id: this.sessionId,
          item: { ...this.currentMessageItem },
        })
        this.currentMessageItem = null
      }
      // session.ended is emitted by the server via onComplete callback, not here
      return events
    }

    return events
  }
}
