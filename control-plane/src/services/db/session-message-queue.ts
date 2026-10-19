import { pool } from './pool'

export interface QueuedMessagePayload {
  message: string
  images: { data: string; media_type: string }[]
  source: string
  callerUserId: string
}

export interface QueuedMessage {
  id: string
  payload: QueuedMessagePayload
}

/** Same key + same payload is a retry; a changed payload is a conflict. */
export async function enqueueSessionMessage(
  sessionId: string,
  requestKey: string,
  payload: QueuedMessagePayload,
): Promise<string | null> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO session_message_queue (session_id, request_key, payload)
     VALUES ($1, $2, $3)
     ON CONFLICT (session_id, request_key) DO UPDATE
       SET request_key = EXCLUDED.request_key
       WHERE session_message_queue.payload = EXCLUDED.payload
     RETURNING id`,
    [sessionId, requestKey, JSON.stringify(payload)],
  )
  return rows[0]?.id ?? null
}

/** Only the oldest undelivered row is eligible, including while it is leased. */
export async function claimQueuedMessage(
  sessionId: string,
  token: string,
): Promise<QueuedMessage | null> {
  const { rows } = await pool.query<QueuedMessage>(
    `UPDATE session_message_queue
        SET delivery_token = $2, delivery_expires_at = now() + interval '120 seconds'
      WHERE id = (SELECT id FROM session_message_queue
                   WHERE session_id = $1 AND delivered_at IS NULL ORDER BY id LIMIT 1)
        AND delivered_at IS NULL
        AND (delivery_token IS NULL OR delivery_expires_at <= now())
      RETURNING id, payload`,
    [sessionId, token],
  )
  return rows[0] ?? null
}

export async function renewQueuedMessage(id: string, token: string): Promise<void> {
  await pool.query(
    `UPDATE session_message_queue SET delivery_expires_at = now() + interval '120 seconds'
      WHERE id = $1 AND delivery_token = $2 AND delivered_at IS NULL`,
    [id, token],
  )
}

export async function finishQueuedMessage(
  id: string,
  token: string,
  delivered: boolean,
): Promise<void> {
  await pool.query(
    `UPDATE session_message_queue
        SET delivered_at = CASE WHEN $3 THEN now() ELSE NULL END,
            delivery_token = NULL, delivery_expires_at = NULL
      WHERE id = $1 AND delivery_token = $2`,
    [id, token, delivered],
  )
}

export async function listQueuedSessions(): Promise<{ id: string; workspace_id: string }[]> {
  const { rows } = await pool.query<{ id: string; workspace_id: string }>(
    `SELECT s.id, s.workspace_id FROM sessions s
      WHERE s.status = 'active'
        AND (s.turn_claim IS NULL OR s.turn_claim_expires_at <= now())
        AND EXISTS (SELECT 1 FROM session_message_queue q
                     WHERE q.session_id = s.id AND q.delivered_at IS NULL)
      ORDER BY s.last_active_at LIMIT 200`,
  )
  return rows
}
