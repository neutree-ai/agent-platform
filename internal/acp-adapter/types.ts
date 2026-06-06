// API request/response types

import type { ChatImageAttachment } from '../types/events.js'

export interface ChatRequest {
  message: string
  session_id?: string // ACP session ID for multi-turn conversations (omit for new session)
  images?: ChatImageAttachment[]
  /**
   * Opaque CP-minted token threaded into the platform MCP server's headers
   * as `X-Session-Token`. CP reverse-resolves it on each MCP call to
   * recover the session identity. Blind passthrough on the agent side.
   */
  session_token?: string
}
