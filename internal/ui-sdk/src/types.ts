// Render-ready transcript types, plus the wire input contract the package
// normalizes from.
//
// The wire types (ApiContentPart/ApiMessage) are defined locally rather than
// imported from @neutree-ai/types so this package is self-contained and
// publishable without coupling to that (currently app-internal) package. They
// are structurally compatible with the platform's ApiMessageSchema, so a host
// can pass its own ApiMessage[] straight in.

export type ApiContentPart =
  | { type: 'text'; text: string }
  | {
      type: 'tool_call'
      call_id: string
      name: string
      arguments: string
      parent_tool_use_id?: string | null
    }
  | {
      type: 'tool_result'
      call_id: string
      output: string
      is_error?: boolean
      parent_tool_use_id?: string | null
    }
  | { type: 'image'; data: string; media_type: string }

export interface ApiMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  blocks: ApiContentPart[]
  created_at: string
  started_at?: string
  ended_at?: string | null
  duration_ms?: number | null
}

// ── Render-ready shapes (what the components consume) ──

export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
  result?: string | object
  isError?: boolean
  startedAt?: number
  completedAt?: number
  resultAt?: number
  parentToolUseId?: string | null
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool'; tool: ToolCall }
  | { type: 'status'; label: string; detail?: string; isError?: boolean }
  | { type: 'image'; data: string; media_type: string }

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  blocks: ContentBlock[]
  isStreaming?: boolean
  created_at?: string
}
