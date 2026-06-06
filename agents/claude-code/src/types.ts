// API request/response types

import type { ChatImageAttachment } from '../../../internal/types/events.js'

export interface ChatRequest {
  message: string
  session_id?: string // SDK session ID for multi-turn conversations (omit for new session)
  images?: ChatImageAttachment[]
  /**
   * Opaque CP-minted token threaded into the platform MCP server's headers
   * as `X-Session-Token`. CP reverse-resolves it on each MCP call to
   * recover the session identity (and, transitively, any teamwork task
   * binding). Treated as a blind passthrough by the agent.
   */
  session_token?: string
}
