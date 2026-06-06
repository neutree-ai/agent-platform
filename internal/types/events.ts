/**
 * Shared agent contract types for the UniversalEvent protocol.
 *
 * These types define the interface between agents and the control-plane/web.
 * Agent implementations (claude-code, etc.) import from here.
 */

// ── UniversalEvent content types ──

export interface ContentDelta {
  type: 'text' | 'reasoning'
  text: string
}

export interface ContentPart {
  type: 'text' | 'tool_call' | 'tool_result' | 'reasoning' | 'status' | 'image'
  text?: string
  call_id?: string
  name?: string
  arguments?: string
  output?: string
  is_error?: boolean
  label?: string
  detail?: string
  // image fields
  data?: string       // base64
  media_type?: string  // e.g. 'image/png'
}

export interface ChatImageAttachment {
  data: string       // base64 encoded
  media_type: string // 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
}

export interface UniversalItem {
  item_id: string
  kind: 'message' | 'tool_call' | 'tool_result' | 'status'
  role: 'user' | 'assistant' | 'tool' | null
  status: 'in_progress' | 'completed' | 'failed'
  content: ContentPart[]
  /** If this item was produced inside a sub-agent, the tool_use_id of the Agent call that spawned it. */
  parent_tool_use_id?: string | null
}

export interface UniversalEvent {
  type: string
  timestamp: number
  session_id?: string
  // session.ended
  reason?: 'completed' | 'error' | 'interrupted'
  stats?: TurnStats
  // item events
  item?: UniversalItem
  item_id?: string
  delta?: ContentDelta
  // question.requested
  request_id?: string
  questions?: unknown[]
  // error
  message?: string
  code?: string
}

// ── Agent lifecycle types ──

/**
 * The live "context gauge" half of a turn's stats: how full the model's context
 * window is right now and how many turns deep the session is. This is a
 * current-state snapshot (not accumulable), and is the only part persisted on
 * the session (`last_turn_stats`) and rendered by the chat stats bar. Token
 * *accounting* lives in the append-only usage ledger, not here.
 */
export interface ContextGauge {
  numTurns: number
  contextTokens: number // last API call's input_tokens ≈ current context size
  contextWindow: number // model's context window limit
}

/**
 * Full per-turn stats an agent emits on session.ended (the live wire shape):
 * the context gauge plus the turn's token/cost figures. The token figures ride
 * along in the synchronous chat response but are NOT the source of truth for
 * usage accounting — that is the workspace usage ledger. Only the ContextGauge
 * subset is persisted on the session.
 */
export interface TurnStats extends ContextGauge {
  costUsd: number
  durationMs: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}

export interface AskUserRequest {
  requestId: string
  questions: unknown[]
}

// ── Agent info contract (GET /info) ──

export interface AgentCapabilities {
  system_prompt: boolean
  mcp: boolean
  skills: boolean
  questions: boolean
  reconnect: boolean
  permissions: boolean
  streaming_deltas: boolean
}

export interface AgentInfo {
  agent_type: string
  model: string
  capabilities: AgentCapabilities
}
