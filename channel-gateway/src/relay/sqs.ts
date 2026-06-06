import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
  GetQueueAttributesCommand,
} from '@aws-sdk/client-sqs'
import type { RelayMessage, RelaySource } from './types'

interface SqsRelayConfig {
  queueUrl: string
  region: string
  accessKeyId?: string
  secretAccessKey?: string
}

export class SqsRelaySource implements RelaySource {
  readonly type = 'sqs'
  private client: SQSClient
  private queueUrl: string

  constructor(private config: SqsRelayConfig) {
    this.queueUrl = config.queueUrl
    this.client = new SQSClient({
      region: config.region,
      ...(config.accessKeyId && config.secretAccessKey
        ? { credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } }
        : {}),
    })
  }

  async poll(maxMessages: number): Promise<RelayMessage[]> {
    const resp = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: Math.min(maxMessages, 10), // SQS max is 10
        WaitTimeSeconds: 20, // Long polling
        MessageAttributeNames: ['All'],
      }),
    )

    return (resp.Messages ?? []).map((msg) => {
      const attrs = msg.MessageAttributes ?? {}
      return {
        id: msg.ReceiptHandle!, // ReceiptHandle is the ack token
        messageId: msg.MessageId!, // Stable ID for dedup
        path: attrs.path?.StringValue ?? '',
        body: msg.Body ?? '',
        headers: attrs.headers?.StringValue ? JSON.parse(attrs.headers.StringValue) : {},
        method: attrs.method?.StringValue ?? 'POST',
        receivedAt: attrs.receivedAt?.StringValue ?? new Date().toISOString(),
      }
    })
  }

  async ack(receiptHandle: string): Promise<void> {
    await this.client.send(
      new DeleteMessageCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: receiptHandle,
      }),
    )
  }

  async nack(receiptHandle: string): Promise<void> {
    await this.client.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: receiptHandle,
        VisibilityTimeout: 0, // Make immediately visible for retry
      }),
    )
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.send(
        new GetQueueAttributesCommand({
          QueueUrl: this.queueUrl,
          AttributeNames: ['ApproximateNumberOfMessages'],
        }),
      )
      return true
    } catch {
      return false
    }
  }

  async close(): Promise<void> {
    this.client.destroy()
  }
}
