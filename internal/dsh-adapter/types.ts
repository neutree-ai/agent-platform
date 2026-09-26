/**
 * The slice of the DeepSeek Harness SDK wire this adapter reads.
 *
 * Hand-written rather than imported from `@deepseek-ai/dsh-session`: the wire
 * contract is what we actually depend on, and dsh is a developer preview whose
 * exported types churn. Narrow structural shapes let a dsh upgrade that adds
 * fields pass through untouched, and one that renames a field we read fail in
 * this file instead of somewhere downstream.
 */

/** One chunk of a model stream, carried by a `chunk` stream frame. */
export type DshStreamChunk =
  | { type: 'block-start'; index: number; blockType: string }
  | { type: 'text-delta'; index: number; text: string }
  | { type: 'reasoning-delta'; index: number; text: string }
  | { type: 'tool-call-delta'; index: number; id?: string; name?: string; argumentsDelta?: string }
  | { type: 'block-end'; index: number; block?: unknown }
  | { type: 'usage'; usage: DshUsage }
  | { type: 'finish'; reason?: { kind?: string } }

/**
 * One live frame of an assistant attempt. Frames are transient — they are not
 * in the session log — and exist so a client can render tokens as they arrive.
 * The attempt settles durably as an `assistant/message` or `assistant/attempt`
 * event before its `end` frame.
 */
export type DshStreamFrame =
  | { type: 'start'; attemptId: string; turn: number; step: number }
  | { type: 'chunk'; attemptId: string; index: number; chunk: DshStreamChunk }
  | { type: 'end'; attemptId: string; outcome: { kind: 'committed' | 'abandoned' } }

export interface DshUsage {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  reasoningTokens?: number
}

/** The `tool` message a `tool/result` event carries. */
export interface DshToolMessage {
  role?: string
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

/** `session.event` notification payload: one session-log event, as recorded. */
export interface DshSessionEventNotification {
  sessionId: string
  event: DshSessionEvent
}

/** `session.status` notification payload — whole-agent lifecycle, not per turn. */
export interface DshSessionStatusNotification {
  sessionId: string
  status: 'running' | 'idle'
}

/** `session.stream` notification payload, published by the platform's server plugin. */
export interface DshSessionStreamNotification {
  sessionId: string
  frame: DshStreamFrame
}

export type DshNotification =
  | { method: 'session.event'; params: DshSessionEventNotification }
  | { method: 'session.status'; params: DshSessionStatusNotification }
  | { method: 'session.stream'; params: DshSessionStreamNotification }

/** Turn outcome, read off `turn/end`. */
export interface DshTurnEnd {
  kind: string
  message?: string
}
