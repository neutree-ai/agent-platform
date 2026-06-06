import { Hono } from 'hono'
import type { AppEnv } from '../lib/types'
import {
  deletePreference,
  getInbox,
  getPreferences,
  getUnreadCount,
  markAllAsRead,
  markAsRead,
  notify,
  setPreference,
} from '../services/notifications'

const notifications = new Hono<AppEnv>()

// Get inbox
notifications.get('/inbox', async (c) => {
  const user = c.get('user')
  const limit = Number.parseInt(c.req.query('limit') || '50', 10)
  const offset = Number.parseInt(c.req.query('offset') || '0', 10)
  const items = await getInbox(user.sub, { limit, offset })
  return c.json(items)
})

// Get unread count
notifications.get('/inbox/unread-count', async (c) => {
  const user = c.get('user')
  const count = await getUnreadCount(user.sub)
  return c.json({ count })
})

// Mark specific notifications as read
notifications.post('/inbox/read', async (c) => {
  const user = c.get('user')
  const body = await c.req.json<{ notification_ids?: string[]; all?: boolean }>()

  if (body.all) {
    await markAllAsRead(user.sub)
  } else if (body.notification_ids?.length) {
    await markAsRead(user.sub, body.notification_ids)
  } else {
    return c.json({ error: 'Provide notification_ids or set all: true' }, 400)
  }

  return c.json({ success: true })
})

// Get user preferences
notifications.get('/preferences', async (c) => {
  const user = c.get('user')
  const scope = c.req.query('scope')
  const prefs = await getPreferences(user.sub, scope)
  return c.json(prefs)
})

// Update a preference
notifications.put('/preferences', async (c) => {
  const user = c.get('user')
  const body = await c.req.json<{
    event_type: string
    channel: string
    enabled: boolean
    scope?: string
  }>()

  if (!body.event_type || !body.channel || typeof body.enabled !== 'boolean') {
    return c.json({ error: 'event_type, channel, and enabled are required' }, 400)
  }

  await setPreference(user.sub, body.event_type, body.channel, body.enabled, body.scope ?? '*')
  return c.json({ success: true })
})

// Delete a preference (reset to inherited)
notifications.delete('/preferences', async (c) => {
  const user = c.get('user')
  const body = await c.req.json<{ event_type: string; channel: string; scope: string }>()

  if (!body.event_type || !body.channel || !body.scope) {
    return c.json({ error: 'event_type, channel, and scope are required' }, 400)
  }

  await deletePreference(user.sub, body.event_type, body.channel, body.scope)
  return c.json({ success: true })
})

// Internal: trigger a notification (for service-to-service calls)
notifications.post('/notify', async (c) => {
  const body = await c.req.json<{
    event_type: string
    title?: string
    body: string
    format?: string
    type?: string
    url?: string
    attach?: string[]
    metadata?: Record<string, unknown>
    actor_id?: string
    target_user_ids: string[]
    scope?: string
  }>()

  if (!body.event_type || !body.body || !body.target_user_ids?.length) {
    return c.json({ error: 'event_type, body, and target_user_ids are required' }, 400)
  }

  const notificationId = await notify({
    eventType: body.event_type,
    payload: {
      title: body.title,
      body: body.body,
      format: body.format as any,
      type: body.type as any,
      url: body.url,
      attach: body.attach,
      metadata: body.metadata,
    },
    actorId: body.actor_id,
    targetUserIds: body.target_user_ids,
    scope: body.scope,
  })

  return c.json({ notification_id: notificationId }, 201)
})

export default notifications
