import type { ChatBody, ChatMode } from '../../../../internal/types/api'

// Pure request-shaping helpers for chat dispatch, extracted from
// executeChat/dispatchChatTurn so the wire contracts (agent /chat body,
// user-message block layout, delivery-mode resolution) are unit-testable
// without pulling in the DB / SSE machinery those orchestrators import.

export interface ChatImage {
  data: string
  media_type: string
}

/**
 * The JSON body cp POSTs to an agent's `/chat`. `session_id` and `images` are
 * omitted (not null) when absent — the agent treats a missing session_id as
 * "create a new session".
 */
export function buildAgentChatBody(opts: {
  message: string | null
  sessionId: string | null
  images: ChatImage[] | null
  source: string
  sessionToken: string
}): Record<string, unknown> {
  return {
    message: opts.message,
    ...(opts.sessionId ? { session_id: opts.sessionId } : {}),
    ...(opts.images?.length ? { images: opts.images } : {}),
    source: opts.source,
    session_token: opts.sessionToken,
  }
}

/**
 * Block layout for eagerly-persisted user messages: one text block first,
 * then one image block per attachment (mirrors what the SSE persist plugin
 * writes for new sessions, so refresh-recovery renders identically).
 */
export function buildUserMessageBlocks(
  text: string,
  images: ChatImage[] | null,
): Array<Record<string, unknown>> {
  const blocks: Array<Record<string, unknown>> = [{ type: 'text', text }]
  if (images?.length) {
    for (const img of images) {
      blocks.push({
        type: 'image',
        data: img.data,
        media_type: img.media_type,
      })
    }
  }
  return blocks
}

/**
 * Resolve the chat delivery mode in this order:
 *   1. `body.mode` if present (`stream` | `sync` | `async`)
 *   2. legacy `body.stream`: `false` → sync, `true` → stream
 *   3. `Accept: application/json` → sync
 *   4. otherwise (default) → stream
 */
export function resolveChatMode(body: ChatBody, acceptHeader: string | undefined): ChatMode {
  if (body.mode) return body.mode
  if (body.stream === false) return 'sync'
  if (body.stream === true) return 'stream'
  if (acceptHeader?.includes('application/json')) return 'sync'
  return 'stream'
}
