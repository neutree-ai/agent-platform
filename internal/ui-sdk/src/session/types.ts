import type { ChatImageAttachment } from '@neutree-ai/sse-consumer'

// The wire types a session uses come with the stream reader.
export type { ChatImageAttachment, ContextGauge, TurnStats } from '@neutree-ai/sse-consumer'

/**
 * A follow-up the user queued while a turn was running. Kept on the session,
 * and sent as a fresh turn by the platform once the running one ends.
 */
export interface PendingMessage {
  content: string
  images: ChatImageAttachment[]
}
