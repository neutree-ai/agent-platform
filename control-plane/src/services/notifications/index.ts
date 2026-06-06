import { pool } from '../db/pool'
import { resolveChannels } from './resolve'
import type { NotificationPayload } from './types'

// Lazy import to avoid circular dependency — worker.ts imports from this file
let _enqueue: ((id: string) => Promise<void>) | null = null
export function setEnqueueFn(fn: (id: string) => Promise<void>) {
  _enqueue = fn
}

// --- Core: send a notification ---

interface NotifyInput {
  eventType: string
  payload: NotificationPayload
  actorId?: string
  targetUserIds: string[]
  scope?: string
}

export async function notify(input: NotifyInput): Promise<string> {
  const { eventType, payload, actorId, targetUserIds, scope = '*' } = input

  // 1. Persist notification event
  const { rows } = await pool.query(
    `INSERT INTO notifications (event_type, title, body, format, type, url, attach, metadata, actor_id, scope)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      eventType,
      payload.title ?? null,
      payload.body,
      payload.format ?? 'markdown',
      payload.type ?? 'info',
      payload.url ?? null,
      payload.attach ? JSON.stringify(payload.attach) : null,
      JSON.stringify(payload.metadata ?? {}),
      actorId ?? null,
      scope,
    ],
  )
  const notificationId = rows[0].id as string

  // 2. For each target user, resolve channels and create delivery records
  for (const userId of targetUserIds) {
    const channels = await getUserChannels(userId, eventType, scope)
    for (const channel of channels) {
      await pool.query(
        `INSERT INTO notification_deliveries (notification_id, user_id, channel)
         VALUES ($1, $2, $3)`,
        [notificationId, userId, channel],
      )
    }
  }

  // 3. Enqueue for delivery (scheduler picks up the job)
  if (_enqueue) await _enqueue(notificationId)

  return notificationId
}

// --- Channel resolution ---

async function getUserChannels(userId: string, eventType: string, scope = '*'): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT event_type, channel, scope, enabled FROM notification_preferences
     WHERE user_id = $1
       AND event_type IN ($2, '*')
       AND scope IN ($3, '*')`,
    [userId, eventType, scope],
  )
  return resolveChannels(rows, eventType, scope)
}

// --- Inbox queries ---

export async function getInbox(userId: string, { limit = 50, offset = 0 } = {}) {
  const { rows } = await pool.query(
    `SELECT n.*, d.id AS delivery_id, d.created_at AS delivered_at,
            r.read_at IS NOT NULL AS is_read
     FROM notification_deliveries d
     JOIN notifications n ON n.id = d.notification_id
     LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = d.user_id
     WHERE d.user_id = $1 AND d.channel = 'inbox' AND d.status = 'sent'
     ORDER BY n.created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset],
  )
  return rows
}

export async function getUnreadCount(userId: string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COUNT(*) AS count
     FROM notification_deliveries d
     LEFT JOIN notification_reads r ON r.notification_id = d.notification_id AND r.user_id = d.user_id
     WHERE d.user_id = $1 AND d.channel = 'inbox' AND d.status = 'sent' AND r.read_at IS NULL`,
    [userId],
  )
  return Number.parseInt(rows[0].count, 10)
}

export async function markAsRead(userId: string, notificationIds: string[]) {
  if (notificationIds.length === 0) return
  const placeholders = notificationIds.map((_, i) => `($1, $${i + 2})`).join(', ')
  await pool.query(
    `INSERT INTO notification_reads (user_id, notification_id) VALUES ${placeholders}
     ON CONFLICT DO NOTHING`,
    [userId, ...notificationIds],
  )
}

export async function markAllAsRead(userId: string) {
  await pool.query(
    `INSERT INTO notification_reads (user_id, notification_id)
     SELECT d.user_id, d.notification_id
     FROM notification_deliveries d
     LEFT JOIN notification_reads r ON r.notification_id = d.notification_id AND r.user_id = d.user_id
     WHERE d.user_id = $1 AND d.channel = 'inbox' AND d.status = 'sent' AND r.read_at IS NULL
     ON CONFLICT DO NOTHING`,
    [userId],
  )
}

// --- Preferences ---

export async function getPreferences(userId: string, scope?: string) {
  if (scope) {
    const { rows } = await pool.query(
      `SELECT event_type, channel, enabled, scope FROM notification_preferences
       WHERE user_id = $1 AND scope = $2`,
      [userId, scope],
    )
    return rows
  }
  const { rows } = await pool.query(
    'SELECT event_type, channel, enabled, scope FROM notification_preferences WHERE user_id = $1',
    [userId],
  )
  return rows
}

export async function setPreference(
  userId: string,
  eventType: string,
  channel: string,
  enabled: boolean,
  scope = '*',
) {
  await pool.query(
    `INSERT INTO notification_preferences (user_id, event_type, channel, enabled, scope)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, event_type, channel, scope) DO UPDATE SET enabled = $4`,
    [userId, eventType, channel, enabled, scope],
  )
}

export async function deletePreference(
  userId: string,
  eventType: string,
  channel: string,
  scope: string,
) {
  await pool.query(
    `DELETE FROM notification_preferences
     WHERE user_id = $1 AND event_type = $2 AND channel = $3 AND scope = $4`,
    [userId, eventType, channel, scope],
  )
}
