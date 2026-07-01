/**
 * Translation layer: ACP SessionUpdate → UniversalEvent protocol.
 *
 * Uses official SDK types from @agentclientprotocol/sdk to ensure
 * correct field access across all session update variants.
 */

import type { PromptResponse, SessionUpdate, UsageUpdate } from '@agentclientprotocol/sdk'
import type {
  AskUserRequest,
  ContentPart,
  TurnStats,
  UniversalEvent,
  UniversalItem,
} from '../types/events.js'

// ── Helpers ──

function ts(): number {
  return Date.now()
}

let _itemCounter = 0
function nextItemId(): string {
  return `item_${Date.now()}_${++_itemCounter}`
}

/** Serialize unknown rawInput/rawOutput to a display string. */
function stringifyRaw(raw: unknown): string {
  if (raw == null) return ''
  if (typeof raw === 'string') return raw
  try {
    return JSON.stringify(raw)
  } catch {
    return String(raw)
  }
}

// ── Translator ──

/**
 * Stateful translator that converts ACP SessionUpdate notifications into
 * UniversalEvent objects. One instance per chat turn.
 */
export class AcpEventTranslator {
  private sessionId: string | undefined
  /** Current assistant message item (accumulates text across stream deltas) */
  private currentMessageItem: UniversalItem | null = null
  /** Accumulated text for the current message (used to fill content on finalize) */
  private accumulatedText = ''
  /**
   * Track active tool calls by their toolCallId for completing them.
   * `lastStatus` mirrors ACP's `ToolCallStatus`: pending/in_progress/completed/failed.
   * Per ACP spec (`ToolCallUpdate`), fields omitted on an update mean "unchanged",
   * so we inherit the previous status rather than defaulting to "completed".
   */
  private activeToolCalls = new Map<
    string,
    {
      itemId: string
      title: string
      rawInput: unknown
      lastStatus: 'pending' | 'in_progress' | 'completed' | 'failed'
      terminalEmitted: boolean
      isImageGen: boolean
    }
  >()
  /** Last usage_update received (for stats extraction) */
  lastUsageUpdate: UsageUpdate | null = null
  /** Timestamp when the current turn started */
  private turnStartMs = 0

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

  // ── ACP SessionUpdate → UniversalEvent[] ──

  /**
   * Translate a single ACP SessionUpdate into zero or more UniversalEvents.
   * Discriminator: `update.sessionUpdate`.
   */
  translateUpdate(update: SessionUpdate): UniversalEvent[] {
    if (!this.turnStartMs) this.turnStartMs = Date.now()
    const events: UniversalEvent[] = []

    console.log(
      `[acp-events] sessionUpdate kind=${update.sessionUpdate} session=${this.sessionId}`,
    )

    switch (update.sessionUpdate) {
      case 'agent_message_chunk': {
        const block = update.content
        if (!block || block.type !== 'text') {
          console.log(
            `[acp-events] agent_message_chunk dropped: block.type=${block?.type ?? 'null'} session=${this.sessionId} keys=${block ? Object.keys(block).join(',') : ''}`,
          )
          break
        }

        // Ensure we have a current message item
        if (!this.currentMessageItem) {
          this.currentMessageItem = {
            item_id: nextItemId(),
            kind: 'message',
            role: 'assistant',
            status: 'in_progress',
            content: [],
          }
          this.accumulatedText = ''
          events.push({
            type: 'item.started',
            timestamp: ts(),
            session_id: this.sessionId,
            item: { ...this.currentMessageItem },
          })
        }

        // Accumulate text so finalize() can include it in the completed item
        this.accumulatedText += block.text

        events.push({
          type: 'item.delta',
          timestamp: ts(),
          session_id: this.sessionId,
          item_id: this.currentMessageItem.item_id,
          delta: { type: 'text', text: block.text },
        })
        break
      }

      case 'tool_call': {
        // Suppress codex-acp's MCP-startup pseudo-tool-calls (id `mcp_startup.*`,
        // kind "other", already-terminal). They are infra diagnostics, not tools
        // the agent invoked; the old Rust codex-acp never surfaced them, and the
        // adapter's start handler would render them as a stuck "other" spinner
        // that never persists. Route MCP health elsewhere, not the chat stream.
        if (update.toolCallId.startsWith('mcp_startup.')) break

        // Finalize any in-progress text message before the tool call
        if (this.currentMessageItem) {
          this.currentMessageItem.status = 'completed'
          if (this.accumulatedText) {
            this.currentMessageItem.content = [{ type: 'text', text: this.accumulatedText }]
          }
          events.push({
            type: 'item.completed',
            timestamp: ts(),
            session_id: this.sessionId,
            item: { ...this.currentMessageItem },
          })
          this.currentMessageItem = null
          this.accumulatedText = ''
        }

        // SDK type: ToolCall & { sessionUpdate: 'tool_call' }
        // Fields: toolCallId, title, kind, status, rawInput, rawOutput, content
        //
        // Prefer ACP `kind` (stable: execute/read/edit/...) as the tool name
        // for the universal protocol. Codex sets `title` to a formatted
        // command preview, which the UI also derives from rawInput — using
        // `title` as `name` causes the same string to render twice.
        const itemId = nextItemId()
        const stableName = update.kind ?? update.title
        // codex's built-in image-generation tool surfaces as a tool_call with
        // kind "other" / title "Image generation" and a call id prefixed `ig_`.
        // Flag it so the completion compensation below can fire — see the
        // tool_call_update handler.
        const isImageGen =
          update.title === 'Image generation' || update.toolCallId.startsWith('ig_')
        this.activeToolCalls.set(update.toolCallId, {
          itemId,
          title: stableName,
          rawInput: update.rawInput,
          lastStatus: update.status ?? 'pending',
          terminalEmitted: false,
          isImageGen,
        })

        const toolItem: UniversalItem = {
          item_id: itemId,
          kind: 'tool_call',
          role: 'assistant',
          status: 'in_progress',
          content: [
            {
              type: 'tool_call',
              call_id: update.toolCallId,
              name: stableName,
              arguments: stringifyRaw(update.rawInput),
            },
          ],
        }
        events.push({
          type: 'item.started',
          timestamp: ts(),
          session_id: this.sessionId,
          item: toolItem,
        })

        // Terminal-on-start: codex-acp can deliver a tool_call that already
        // carries a terminal status with no follow-up tool_call_update. Without
        // this the card spins forever and never persists (cp writes tool_calls
        // only on item.completed). Synthesize the completion by replaying this
        // event through the tool_call_update path (the tracked entry is set
        // above), which reuses all the terminal/output handling.
        if (update.status === 'completed' || update.status === 'failed') {
          events.push(
            ...this.translateUpdate({ ...update, sessionUpdate: 'tool_call_update' } as SessionUpdate),
          )
        }
        break
      }

      case 'tool_call_update': {
        // SDK type: ToolCallUpdate & { sessionUpdate: 'tool_call_update' }
        // Fields: toolCallId, status, rawInput, rawOutput, content, title, kind.
        //
        // Per ACP spec, fields omitted on an update mean "unchanged". Codex
        // streams unified_exec stdout via many updates that carry only the
        // growing rawOutput and leave status unset — we MUST NOT default
        // those to "completed" or we emit N terminal events for one call
        // (which previously overwhelmed the DB/SSE pipe). Inherit status
        // from the tracked state and only emit once on the real transition
        // into a terminal state.
        const tracked = this.activeToolCalls.get(update.toolCallId)
        let effectiveStatus = update.status ?? tracked?.lastStatus ?? 'in_progress'

        // codex reports the image-generation item's status as "generating" even
        // on its item/completed event, so codex-acp maps the completion to a
        // tool_call_update that stays "in_progress" while already carrying the
        // finished image in `content`. Without compensation the terminal
        // transition never fires, cp never persists the tool_call, and the image
        // never renders (cp only writes tool_calls on item.completed). When an
        // image-generation call delivers image content, treat it as completed.
        // (Upstream fix belongs in codex-acp's createImageGenerationCompleteUpdate.)
        if (
          tracked?.isImageGen &&
          effectiveStatus !== 'failed' &&
          ((update as any).content ?? []).some(
            (tc: any) => tc?.type === 'image' || tc?.content?.type === 'image',
          )
        ) {
          effectiveStatus = 'completed'
        }

        if (tracked) {
          if (update.rawInput !== undefined) tracked.rawInput = update.rawInput
          // Mirror the started-side preference: kind is the stable name; only
          // accept `title` as a fallback if no kind was ever set.
          const updatedName = update.kind ?? update.title
          if (updatedName !== undefined && updatedName !== null) tracked.title = updatedName
          tracked.lastStatus = effectiveStatus
        }

        if (effectiveStatus !== 'completed' && effectiveStatus !== 'failed') break
        // Already emitted the terminal pair once — suppress any further
        // post-terminal updates (spec-violating but defensive).
        if (tracked?.terminalEmitted) break
        if (tracked) tracked.terminalEmitted = true

        const itemId = tracked?.itemId ?? nextItemId()
        this.activeToolCalls.delete(update.toolCallId)

        // Emit item.completed for the tool_call itself (fills in input in the UI)
        const finalInput = update.rawInput ?? tracked?.rawInput
        const toolName = update.kind ?? update.title ?? tracked?.title ?? ''
        events.push({
          type: 'item.completed',
          timestamp: ts(),
          session_id: this.sessionId,
          item: {
            item_id: itemId,
            kind: 'tool_call',
            role: 'assistant',
            status: 'completed',
            content: [
              {
                type: 'tool_call',
                call_id: update.toolCallId,
                name: toolName,
                arguments: stringifyRaw(finalInput),
              },
            ],
          },
        })

        console.log(
          `[acp-events] tool_call_update terminal call=${update.toolCallId} title=${toolName} status=${effectiveStatus} rawOutputType=${typeof update.rawOutput} contentTypes=${(update.content ?? []).map((tc: any) => tc?.type + (tc?.content?.type ? `(${tc.content.type})` : '')).join('|')}`,
        )

        // Extract output: prefer rawOutput, fall back to content blocks
        let output = stringifyRaw(update.rawOutput)
        if (!output && update.content) {
          output = update.content
            .map((tc: any) => {
              if (tc.type === 'content' && tc.content) {
                const inner = tc.content
                if (inner?.type === 'text') return inner.text ?? ''
                console.log(
                  `[acp-events] tool_call_update content unhandled inner.type=${inner?.type} call=${update.toolCallId} keys=${inner ? Object.keys(inner).join(',') : ''}`,
                )
                return stringifyRaw(inner)
              }
              if (tc.type === 'diff') {
                const path = tc.path ?? ''
                const oldText = tc.oldText ?? ''
                const newText = tc.newText ?? ''
                if (oldText) return `--- ${path}\n+++ ${path}\n${oldText}\n→\n${newText}`
                return `+++ ${path}\n${newText}`
              }
              if (tc.type === 'terminal') {
                return `[terminal: ${tc.terminalId ?? ''}]`
              }
              console.log(
                `[acp-events] tool_call_update content block unhandled type=${tc?.type} call=${update.toolCallId}`,
              )
              return ''
            })
            .filter(Boolean)
            .join('\n')
        }

        // Image generation: codex-acp's raw output carries the full base64 image
        // under `result` (megabytes). Dumping it as tool_result text would bloat
        // the model context and the DB, so replace the output with a concise
        // summary that points the model at the saved file. (Inline thumbnail
        // rendering is a separate follow-up: ContentPart only carries base64
        // `data`, so showing the image in-chat would mean persisting MBs per
        // generation — that needs a uri-based design + cp/UI work.)
        if (tracked?.isImageGen) {
          const ro = (update.rawOutput ?? {}) as Record<string, unknown>
          const saved = typeof ro.savedPath === 'string' ? ro.savedPath : undefined
          const revised = typeof ro.revisedPrompt === 'string' ? ro.revisedPrompt : undefined
          output = ['Image generated.', revised && `Revised prompt: ${revised}`, saved && `Saved to: ${saved}`]
            .filter(Boolean)
            .join('\n')
        }

        const isError = effectiveStatus === 'failed'
        const content: ContentPart[] = [
          {
            type: 'tool_result',
            call_id: update.toolCallId,
            output,
            is_error: isError,
          },
        ]

        const resultItem: UniversalItem = {
          item_id: nextItemId(),
          kind: 'tool_result',
          role: 'tool',
          status: isError ? 'failed' : 'completed',
          content,
        }

        events.push({
          type: 'item.completed',
          timestamp: ts(),
          session_id: this.sessionId,
          item: resultItem,
        })
        break
      }

      case 'plan': {
        // Plan updates (thinking/planning steps) — no UI mapping for now
        break
      }

      case 'usage_update': {
        // Store latest usage for stats extraction. ACP exposes used/size/cost
        // on the public schema; codex may attach extras (per-call input/output
        // tokens) under `_meta`. Keep the full payload so buildStats can mine
        // it later.
        this.lastUsageUpdate = update
        if (process.env.DEBUG_ACP_STATS) {
          console.log(`[acp-stats] usage_update raw=${JSON.stringify(update)}`)
        }
        break
      }

      case 'agent_thought_chunk': {
        // Internal reasoning — not surfaced to the user
        break
      }

      default:
        console.log(`[acp-events] Unhandled sessionUpdate: ${(update as any).sessionUpdate}`)
        break
    }

    return events
  }

  /**
   * Build TurnStats from accumulated usage_update data and prompt result.
   *
   * Two ACP carriers feed this:
   *   - PromptResponse.usage (experimental): per-turn input/output/cache tokens
   *   - UsageUpdate event: cumulative context size + cost
   *
   * Codex CLI does not populate PromptResponse.usage today, so input/output
   * remain 0 for codex; cost from usage_update.cost is still captured.
   */
  buildStats(result?: PromptResponse): TurnStats | undefined {
    const u = this.lastUsageUpdate
    const usage = result?.usage
    if (!u && !usage) return undefined
    const durationMs = this.turnStartMs ? Date.now() - this.turnStartMs : 0
    this.turnStartMs = 0
    if (process.env.DEBUG_ACP_STATS) {
      console.log(
        `[acp-stats] turn-end result.usage=${JSON.stringify(usage ?? null)} lastUsage=${JSON.stringify(u ?? null)}`,
      )
    }
    return {
      costUsd: u?.cost?.amount ?? 0,
      durationMs,
      numTurns: 1,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      cacheReadTokens: usage?.cachedReadTokens ?? 0,
      cacheCreationTokens: usage?.cachedWriteTokens ?? 0,
      contextTokens: u?.used ?? 0,
      contextWindow: u?.size ?? 0,
    }
  }

  /**
   * Finalize any in-progress message item (called when the turn ends).
   */
  finalize(): UniversalEvent[] {
    const events: UniversalEvent[] = []

    if (this.currentMessageItem) {
      this.currentMessageItem.status = 'completed'
      // Include accumulated text in the completed item so it gets persisted
      if (this.accumulatedText) {
        this.currentMessageItem.content = [{ type: 'text', text: this.accumulatedText }]
      }
      events.push({
        type: 'item.completed',
        timestamp: ts(),
        session_id: this.sessionId,
        item: { ...this.currentMessageItem },
      })
      this.currentMessageItem = null
      this.accumulatedText = ''
    }

    return events
  }
}
