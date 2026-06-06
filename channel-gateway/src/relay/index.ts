import * as db from '../services/db'
import { handleWebhookPayload } from '../connectors/webhook'
import { RelayConsumer } from './consumer'
import { SqsRelaySource } from './sqs'
import type { RelayMessage } from './types'

/**
 * Active consumers keyed by queue URL (de-duplicated).
 * Multiple connectors sharing the same queue share one consumer.
 */
const activeConsumers = new Map<string, { consumer: RelayConsumer; connectorIds: Set<string> }>()

/** Parse /webhook/:connectorId/:path from the relay message path. */
function parsePath(path: string): { connectorId: string; externalId: string } | null {
  const match = path.match(/^\/webhook\/([^/]+)\/(.+)$/)
  if (!match) return null
  return { connectorId: match[1], externalId: `/${match[2]}` }
}

/** Handle a relay message by delegating to the shared webhook handler. */
async function handleMessage(msg: RelayMessage): Promise<void> {
  const parsed = parsePath(msg.path)
  if (!parsed) {
    console.warn(`[Relay] Invalid message path: ${msg.path}`)
    return
  }

  // Parse body as JSON if possible
  let body: unknown = msg.body
  try {
    body = JSON.parse(msg.body)
  } catch {
    // Keep as string
  }

  const result = await handleWebhookPayload({
    connectorId: parsed.connectorId,
    externalId: parsed.externalId,
    body,
    rawBody: msg.body,
    headers: msg.headers,
    method: msg.method,
    query: {},
    dedupKey: `relay:${msg.messageId}`,
  })

  if (result.error && result.error !== 'no route for this path') {
    // Throw to trigger nack/retry for retriable errors
    if (result.error === 'failed to create job' || result.error === 'connector not configured (missing platform token)') {
      throw new Error(`[Relay] ${result.error} for path=${msg.path}`)
    }
    // Non-retriable errors (not found, unauthorized, disabled) — just log and ack
    console.warn(`[Relay] Non-retriable: ${result.error} for path=${msg.path}`)
  }
}

/** Start a consumer for a connector. De-duplicates by queue URL. */
export async function startOne(connectorId: string): Promise<void> {
  const connector = await db.getConnector(connectorId)
  if (!connector || connector.type !== 'webhook-relay' || !connector.enabled) return

  const creds = connector.credentials as {
    queue_url?: string
    region?: string
    access_key_id?: string
    secret_access_key?: string
  }

  if (!creds.queue_url || !creds.region) {
    console.error(`[Relay] Connector ${connectorId} missing queue_url or region`)
    return
  }

  const queueUrl = creds.queue_url

  // If a consumer already exists for this queue, just register the connector
  const existing = activeConsumers.get(queueUrl)
  if (existing) {
    existing.connectorIds.add(connectorId)
    console.log(`[Relay] Connector ${connectorId} joined existing consumer for ${queueUrl}`)
    return
  }

  // Create new consumer
  const source = new SqsRelaySource({
    queueUrl,
    region: creds.region,
    accessKeyId: creds.access_key_id,
    secretAccessKey: creds.secret_access_key,
  })

  const consumer = new RelayConsumer(source, handleMessage)
  activeConsumers.set(queueUrl, { consumer, connectorIds: new Set([connectorId]) })

  // Start polling in background
  consumer.start().catch((e) => {
    console.error(`[Relay] Consumer for ${queueUrl} crashed:`, e)
    activeConsumers.delete(queueUrl)
  })

  console.log(`[Relay] Started consumer for ${queueUrl} (connector: ${connectorId})`)
}

/** Stop a consumer for a connector. Only stops the actual consumer when no connectors remain. */
export async function stopOne(connectorId: string): Promise<void> {
  for (const [queueUrl, entry] of activeConsumers) {
    if (entry.connectorIds.has(connectorId)) {
      entry.connectorIds.delete(connectorId)
      if (entry.connectorIds.size === 0) {
        await entry.consumer.stop()
        activeConsumers.delete(queueUrl)
        console.log(`[Relay] Stopped consumer for ${queueUrl} (last connector: ${connectorId})`)
      } else {
        console.log(`[Relay] Connector ${connectorId} left consumer for ${queueUrl} (${entry.connectorIds.size} remaining)`)
      }
      return
    }
  }
}

export async function restartOne(connectorId: string): Promise<void> {
  await stopOne(connectorId)
  await startOne(connectorId)
}

/** Start consumers for all enabled webhook-relay connectors. */
export async function startAll(): Promise<void> {
  const connectors = await db.listRelayConnectors()
  for (const connector of connectors) {
    await startOne(connector.id)
  }
  if (connectors.length > 0) {
    console.log(`[Relay] Initialized ${connectors.length} connector(s), ${activeConsumers.size} consumer(s)`)
  }
}

/** Stop all consumers. */
export async function stopAll(): Promise<void> {
  const entries = [...activeConsumers.entries()]
  for (const [queueUrl, entry] of entries) {
    await entry.consumer.stop()
    activeConsumers.delete(queueUrl)
  }
}
