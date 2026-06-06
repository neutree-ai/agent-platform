/**
 * Generic relay source interface.
 * SQS is our first implementation; other backends (Redis Streams, AMQP, etc.)
 * can implement this interface for customers on different infrastructure.
 */

export interface RelayMessage {
  /** Receipt handle for ack/nack */
  id: string
  /** Stable message ID for deduplication */
  messageId: string
  /** Original webhook path, e.g. /webhook/conn_xxx/push */
  path: string
  /** Raw request body */
  body: string
  /** Original request headers */
  headers: Record<string, string>
  /** HTTP method */
  method: string
  /** When the relay received the message (ISO 8601) */
  receivedAt: string
}

export interface RelaySource {
  readonly type: string

  /** Long-poll for messages. Should block when no messages are available. */
  poll(maxMessages: number): Promise<RelayMessage[]>

  /** Acknowledge successful processing — message removed from queue. */
  ack(messageId: string): Promise<void>

  /** Return message to queue for retry (optional — falls back to visibility timeout). */
  nack?(messageId: string): Promise<void>

  /** Check connectivity to the queue. */
  healthCheck(): Promise<boolean>

  /** Graceful shutdown. */
  close(): Promise<void>
}
