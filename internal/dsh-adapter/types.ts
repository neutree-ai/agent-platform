/**
 * The slice of the DeepSeek Harness session-log vocabulary this adapter reads.
 *
 * Hand-written rather than imported from `@deepseek-ai/dsh-session`: the wire
 * contract is what we actually depend on, and dsh is a developer preview whose
 * exported types churn. Narrow structural shapes let a dsh upgrade that adds
 * fields pass through untouched, and one that renames a field we read fail in
 * this file instead of somewhere downstream.
 */

/** `data.chunk` of an `assistant/chunk` event — the raw model stream. */
export type DshStreamChunk =
  | { type: 'block-start'; index: number; blockType: string }
  | { type: 'text-delta'; index: number; text: string }
  | { type: 'reasoning-delta'; index: number; text: string }
  | { type: 'tool-call-delta'; index: number; id?: string; name?: string; argumentsDelta?: string }
  | { type: 'block-end'; index: number; block?: unknown }
  | { type: 'usage'; usage: DshUsage }
  | { type: 'finish'; reason?: { kind?: string } }

export interface DshUsage {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  reasoningTokens?: number
}

/** One `tool-result` content block inside a `tool/result` event's message. */
export interface DshToolResultBlock {
  type?: string
  toolCallId?: string
  content?: { type?: string; text?: string }[]
  isError?: boolean
}

export interface DshSessionEvent {
  type: string
  seq: number
  time: number
  data?: Record<string, unknown>
}

/** `session.event` notification payload. */
export interface DshSessionEventNotification {
  sessionId: string
  event: DshSessionEvent
}

/** `session.status` notification payload — whole-agent lifecycle, not per turn. */
export interface DshSessionStatusNotification {
  sessionId: string
  status: 'running' | 'idle'
}

export type DshNotification =
  | { method: 'session.event'; params: DshSessionEventNotification }
  | { method: 'session.status'; params: DshSessionStatusNotification }
  | { method: string; params?: unknown }

/** Turn outcome, read off `turn/end`. */
export interface DshTurnEnd {
  kind: string
  message?: string
}
