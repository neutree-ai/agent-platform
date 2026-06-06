import type { PgBoss } from 'pg-boss'
import { pool } from './db'

const NOTIFICATION_QUEUE = 'notification-deliver'

// --- Channel Adapter ---

interface NotificationPayload {
  title?: string
  body: string
  format?: string
  type?: string
  url?: string
  attach?: string[] | null
  metadata?: Record<string, unknown>
}

interface ChannelAdapter {
  channel: string
  send(userId: string, payload: NotificationPayload): Promise<{ ok: boolean; error?: string }>
}

// --- Adapters ---

class InboxAdapter implements ChannelAdapter {
  channel = 'inbox'
  async send() {
    // Inbox delivery is implicit — the notification + delivery record IS the inbox.
    return { ok: true }
  }
}

class AppriseAdapter implements ChannelAdapter {
  channel: string
  private baseUrl: string
  private resolveUrl: (userId: string) => Promise<string>

  constructor(opts: { channel: string; baseUrl: string; resolveUrl: (userId: string) => Promise<string> }) {
    this.channel = opts.channel
    this.baseUrl = opts.baseUrl
    this.resolveUrl = opts.resolveUrl
  }

  async send(userId: string, payload: NotificationPayload) {
    const url = await this.resolveUrl(userId)
    const body = payload.url ? `${payload.body}\n\n${payload.url}` : payload.body

    const res = await fetch(`${this.baseUrl}/notify/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        urls: url,
        title: payload.title,
        body,
        type: payload.type ?? 'info',
        format: payload.format ?? 'markdown',
        ...(payload.attach?.length ? { attach: payload.attach } : {}),
      }),
    })

    return { ok: res.ok, error: res.ok ? undefined : await res.text() }
  }
}

// --- WeChat Work App Message Adapter ---

const WECOM_CORP_ID = process.env.WECOM_CORP_ID || ''
const WECOM_CORP_SECRET = process.env.WECOM_CORP_SECRET || ''
const WECOM_AGENT_ID = process.env.WECOM_AGENT_ID || ''

let wecomAccessToken: string | null = null
let wecomTokenExpiresAt = 0

async function getWeComAccessToken(): Promise<string> {
  if (wecomAccessToken && Date.now() < wecomTokenExpiresAt - 60_000) {
    return wecomAccessToken
  }
  const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${WECOM_CORP_ID}&corpsecret=${WECOM_CORP_SECRET}`
  const res = await fetch(url)
  const data = await res.json() as { errcode: number; errmsg: string; access_token: string; expires_in: number }
  if (data.errcode !== 0) throw new Error(`WeChat Work gettoken: ${data.errmsg}`)
  wecomAccessToken = data.access_token
  wecomTokenExpiresAt = Date.now() + data.expires_in * 1000
  return wecomAccessToken
}

class WeComAppAdapter implements ChannelAdapter {
  channel = 'wecom'

  async send(userId: string, payload: NotificationPayload) {
    // Look up the user's WeChat Work userid from identity binding
    const { rows } = await pool.query(
      `SELECT external_id FROM user_identities WHERE user_id = $1 AND provider = 'wecom'`,
      [userId],
    )
    if (!rows[0]) return { ok: false, error: 'User has no WeChat Work binding' }

    const wecomUserId = rows[0].external_id
    const content = payload.url ? `${payload.body}\n\n[View](${payload.url})` : payload.body

    const token = await getWeComAccessToken()
    const res = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        touser: wecomUserId,
        msgtype: 'markdown',
        agentid: parseInt(WECOM_AGENT_ID, 10),
        markdown: { content },
      }),
    })
    const data = await res.json() as { errcode: number; errmsg: string }
    return { ok: data.errcode === 0, error: data.errcode === 0 ? undefined : data.errmsg }
  }
}

// --- Adapter Registry ---

const adapters = new Map<string, ChannelAdapter>()

function initAdapters() {
  adapters.set('inbox', new InboxAdapter())

  if (WECOM_CORP_ID && WECOM_CORP_SECRET && WECOM_AGENT_ID) {
    adapters.set('wecom', new WeComAppAdapter())
  }
}

// --- Delivery Processing ---

async function processDeliveries(notificationId: string) {
  const { rows: [notification] } = await pool.query(
    `SELECT * FROM notifications WHERE id = $1`,
    [notificationId],
  )
  if (!notification) return

  const { rows: deliveries } = await pool.query(
    `SELECT * FROM notification_deliveries WHERE notification_id = $1 AND status = 'pending'`,
    [notificationId],
  )

  for (const delivery of deliveries) {
    const adapter = adapters.get(delivery.channel)
    if (!adapter) {
      await updateDeliveryStatus(delivery.id, 'failed', `No adapter for channel: ${delivery.channel}`)
      continue
    }

    const payload: NotificationPayload = {
      title: notification.title,
      body: notification.body,
      format: notification.format,
      type: notification.type,
      url: notification.url,
      attach: notification.attach,
      metadata: notification.metadata,
    }

    try {
      const result = await adapter.send(delivery.user_id, payload)
      await updateDeliveryStatus(delivery.id, result.ok ? 'sent' : 'failed', result.error)
    } catch (err: any) {
      await updateDeliveryStatus(delivery.id, 'failed', err.message)
    }
  }
}

async function updateDeliveryStatus(deliveryId: string, status: string, error?: string) {
  await pool.query(
    `UPDATE notification_deliveries
     SET status = $2, error = $3, delivered_at = CASE WHEN $2 = 'sent' THEN now() ELSE NULL END
     WHERE id = $1`,
    [deliveryId, status, error ?? null],
  )
}

// --- Register with pg-boss ---

export async function registerNotificationWorker(boss: PgBoss) {
  await boss.createQueue(NOTIFICATION_QUEUE, {
    retryLimit: 2,
    retryDelay: 30,
    expireInSeconds: 300,
    retentionSeconds: 7 * 24 * 3600,
  }).catch(() => {})

  initAdapters()

  await boss.work<{ notificationId: string }>(
    NOTIFICATION_QUEUE,
    { localConcurrency: 5 },
    async ([job]) => {
      console.log(`[Notifications] Processing notification=${job.data.notificationId}`)
      try {
        await processDeliveries(job.data.notificationId)
        console.log(`[Notifications] Done notification=${job.data.notificationId}`)
      } catch (err) {
        console.error(`[Notifications] Failed notification=${job.data.notificationId}:`, err)
        throw err
      }
    },
  )

  console.log('[Notifications] Worker registered')
}
