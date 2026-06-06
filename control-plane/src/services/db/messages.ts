import { generateId, pool } from './pool'
import type { Message, MessageWithBlocks } from './types'

export async function addMessage(
  workspaceId: string,
  sessionId: string | null,
  role: string,
  content: string,
): Promise<Message> {
  const id = generateId()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      'INSERT INTO messages (id, workspace_id, session_id, role, content) VALUES ($1, $2, $3, $4, $5)',
      [id, workspaceId, sessionId, role, content],
    )
    if (sessionId) {
      await client.query('UPDATE sessions SET last_active_at = NOW() WHERE id = $1', [sessionId])
    }
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
  return (await getMessage(id))!
}

export async function updateMessageContent(id: string, content: string): Promise<void> {
  await pool.query('UPDATE messages SET content = $1 WHERE id = $2', [content, id])
}

async function getMessage(id: string): Promise<Message | null> {
  const { rows } = await pool.query('SELECT * FROM messages WHERE id = $1', [id])
  return (rows[0] as Message) ?? null
}

export async function getMessages(workspaceId: string, sessionId: string): Promise<Message[]> {
  const { rows } = await pool.query(
    'SELECT * FROM messages WHERE workspace_id = $1 AND session_id = $2 ORDER BY created_at ASC',
    [workspaceId, sessionId],
  )
  return rows as Message[]
}

export async function getLastAssistantMessage(sessionId: string): Promise<Message | null> {
  const { rows } = await pool.query(
    `SELECT * FROM messages
     WHERE session_id = $1 AND role = 'assistant'
     ORDER BY created_at DESC LIMIT 1`,
    [sessionId],
  )
  return (rows[0] as Message) ?? null
}

async function getLastMessage(sessionId: string): Promise<Message | null> {
  const { rows } = await pool.query(
    'SELECT * FROM messages WHERE session_id = $1 ORDER BY created_at DESC LIMIT 1',
    [sessionId],
  )
  return (rows[0] as Message) ?? null
}

// ── session_events ─────────────────────────────────────────────────────────

function padOrdinal(n: number): string {
  return n.toString().padStart(5, '0')
}

function sanitize(value: unknown): unknown {
  if (typeof value === 'string') return value.replaceAll('\0', '\uFFFD')
  if (Array.isArray(value)) return value.map(sanitize)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitize(v)
    }
    return out
  }
  return value
}

function eventId(messageId: string, ordinal: number): string {
  return `${messageId}-${padOrdinal(ordinal)}`
}

export async function insertEvent(params: {
  messageId: string
  sessionId: string
  ordinal: number
  kind: string
  callId?: string | null
  payload: unknown
}): Promise<void> {
  const id = eventId(params.messageId, params.ordinal)
  const payload = sanitize(params.payload)
  await pool.query(
    `INSERT INTO session_events (id, message_id, session_id, kind, call_id, payload)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO NOTHING`,
    [
      id,
      params.messageId,
      params.sessionId,
      params.kind,
      params.callId ?? null,
      JSON.stringify(payload),
    ],
  )
}

/**
 * Upsert variant used for tool_result rows that Codex streams incrementally.
 * The bridge fires many `tool_call_update`s per call_id as stdout accumulates;
 * we reuse a stable ordinal per call_id so later (larger) outputs overwrite
 * earlier ones instead of creating N rows. Paired with coalescing in the
 * persist plugin so we also bound the write rate.
 */
export async function upsertEvent(params: {
  messageId: string
  sessionId: string
  ordinal: number
  kind: string
  callId?: string | null
  payload: unknown
}): Promise<void> {
  const id = eventId(params.messageId, params.ordinal)
  const payload = sanitize(params.payload)
  await pool.query(
    `INSERT INTO session_events (id, message_id, session_id, kind, call_id, payload)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload`,
    [
      id,
      params.messageId,
      params.sessionId,
      params.kind,
      params.callId ?? null,
      JSON.stringify(payload),
    ],
  )
}

/** Bulk-insert blocks for a user message (text + optional images) in one statement. */
export async function insertUserMessageBlocks(
  messageId: string,
  sessionId: string,
  blocks: Array<Record<string, unknown>>,
): Promise<void> {
  if (blocks.length === 0) return
  const values: unknown[] = []
  const placeholders: string[] = []
  blocks.forEach((block, i) => {
    const sanitized = sanitize(block) as Record<string, unknown>
    const kind = typeof sanitized?.type === 'string' ? sanitized.type : 'unknown'
    const base = i * 5
    placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`)
    values.push(eventId(messageId, i), messageId, sessionId, kind, JSON.stringify(sanitized))
  })
  await pool.query(
    `INSERT INTO session_events (id, message_id, session_id, kind, payload)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT (id) DO NOTHING`,
    values,
  )
}

interface MessageEvents {
  /** Event payloads in id (chronological) order. */
  blocks: unknown[]
  /**
   * Latest event timestamp = turn end. Computed as MAX over rows rather than
   * "last by id" because tool_result upserts keep their original created_at
   * while their ordinal/id stays put. Date at runtime; serialized to ISO.
   */
  endedAt: Date | null
}

function trackEnd(prev: Date | null, created_at: Date): Date | null {
  return prev === null || created_at > prev ? created_at : prev
}

async function getEventsByMessageId(messageId: string): Promise<MessageEvents> {
  const { rows } = await pool.query<{ payload: unknown; created_at: Date }>(
    'SELECT payload, created_at FROM session_events WHERE message_id = $1 ORDER BY id ASC',
    [messageId],
  )
  let endedAt: Date | null = null
  const blocks = rows.map((r) => {
    endedAt = trackEnd(endedAt, r.created_at)
    return r.payload
  })
  return { blocks, endedAt }
}

/**
 * Batch-load events for multiple messages. Returns a Map keyed by message_id.
 * Carries created_at so turn end time is derived from the same scan that loads
 * the payloads — no separate aggregate query / second pass over the table.
 */
async function getEventsByMessageIds(messageIds: string[]): Promise<Map<string, MessageEvents>> {
  const result = new Map<string, MessageEvents>()
  if (messageIds.length === 0) return result
  const { rows } = await pool.query<{ message_id: string; payload: unknown; created_at: Date }>(
    `SELECT message_id, payload, created_at FROM session_events
     WHERE message_id = ANY($1::text[])
     ORDER BY message_id, id ASC`,
    [messageIds],
  )
  for (const r of rows) {
    let entry = result.get(r.message_id)
    if (!entry) {
      entry = { blocks: [], endedAt: null }
      result.set(r.message_id, entry)
    }
    entry.blocks.push(r.payload)
    entry.endedAt = trackEnd(entry.endedAt, r.created_at)
  }
  return result
}

/**
 * Attach per-turn timing derived from session_events.created_at:
 * started_at (= message.created_at, the turn start), ended_at (latest event),
 * duration_ms. Pure query-layer; no event payload carries these.
 */
function withTiming(m: Message, ev: MessageEvents | undefined): MessageWithBlocks {
  const blocks = ev?.blocks ?? []
  const endedAt = ev?.endedAt ?? null
  const duration_ms = endedAt === null ? null : endedAt.getTime() - new Date(m.created_at).getTime()
  return {
    ...m,
    blocks,
    started_at: m.created_at,
    ended_at: endedAt === null ? null : endedAt.toISOString(),
    duration_ms,
  }
}

/** Convenience: fetch messages + attach their blocks in one batched query. */
export async function getMessagesWithBlocks(
  workspaceId: string,
  sessionId: string,
): Promise<MessageWithBlocks[]> {
  const messages = await getMessages(workspaceId, sessionId)
  if (messages.length === 0) return []
  const events = await getEventsByMessageIds(messages.map((m) => m.id))
  return messages.map((m) => withTiming(m, events.get(m.id)))
}

export async function getLastMessageWithBlocks(
  sessionId: string,
): Promise<MessageWithBlocks | null> {
  const last = await getLastMessage(sessionId)
  if (!last) return null
  return withTiming(last, await getEventsByMessageId(last.id))
}
