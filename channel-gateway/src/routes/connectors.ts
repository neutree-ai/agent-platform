import { WebClient } from '@slack/web-api'
import { Hono } from 'hono'
import * as slack from '../connectors/slack'
import * as wecom from '../connectors/wecom'
import * as relay from '../relay'
import type { AppEnv } from '../lib/types'
import * as db from '../services/db'

const app = new Hono<AppEnv>()

/** Strip secrets from connector for API responses */
function sanitize(conn: db.Connector) {
  return { ...conn, credentials: undefined }
}

// List connectors
app.get('/', async (c) => {
  const userId = c.get('user').sub
  const connectors = await db.listConnectors(userId)
  return c.json(connectors.map(sanitize))
})

// Create connector
app.post('/', async (c) => {
  const userId = c.get('user').sub
  const body = await c.req.json()
  const { type, name, credentials, config, is_public } = body

  if (!type || !name) {
    return c.json({ error: 'type and name are required' }, 400)
  }

  const connector = await db.createConnector({ user_id: userId, type, name, credentials, config, is_public })
  if (connector.enabled) {
    if (connector.type === 'slack') {
      slack.startOne(connector.id).catch((e) => console.error('[Slack] Failed to auto-start connector:', e))
    } else if (connector.type === 'wecom') {
      wecom.startOne(connector.id).catch((e) => console.error('[WeCom] Failed to auto-start connector:', e))
    } else if (connector.type === 'webhook-relay') {
      relay.startOne(connector.id).catch((e) => console.error('[Relay] Failed to auto-start connector:', e))
    }
  }
  return c.json(sanitize(connector), 201)
})

// Get connector
app.get('/:id', async (c) => {
  const userId = c.get('user').sub
  const connector = await db.getConnector(c.req.param('id'), userId)
  if (!connector) return c.json({ error: 'not found' }, 404)
  return c.json(sanitize(connector))
})

// Credential keys that are write-only (masked after creation)
const MASKED_CREDENTIAL_KEYS = new Set(['access_key_id', 'secret_access_key'])

function maskCredentials(creds: Record<string, unknown>): Record<string, unknown> {
  const result = { ...creds }
  for (const key of MASKED_CREDENTIAL_KEYS) {
    const val = result[key]
    if (typeof val === 'string' && val.length > 0) {
      result[key] = '****' + val.slice(-4)
    }
  }
  return result
}

// Get connector credentials (owner only)
app.get('/:id/credentials', async (c) => {
  const userId = c.get('user').sub
  const connector = await db.getConnector(c.req.param('id'), userId)
  if (!connector) return c.json({ error: 'not found' }, 404)
  if (connector.user_id !== userId) return c.json({ error: 'forbidden' }, 403)
  return c.json(maskCredentials(connector.credentials || {}))
})

// Update connector
app.patch('/:id', async (c) => {
  const userId = c.get('user').sub
  const body = await c.req.json()
  const connector = await db.updateConnector(c.req.param('id'), userId, body)
  if (!connector) return c.json({ error: 'not found' }, 404)
  if (connector.type === 'slack') {
    if (connector.enabled) {
      slack.restartOne(connector.id).catch((e) => console.error('[Slack] Failed to restart connector:', e))
    } else {
      slack.stopOne(connector.id).catch((e) => console.error('[Slack] Failed to stop connector:', e))
    }
  } else if (connector.type === 'wecom') {
    if (connector.enabled) {
      wecom.restartOne(connector.id).catch((e) => console.error('[WeCom] Failed to restart connector:', e))
    } else {
      wecom.stopOne(connector.id).catch((e) => console.error('[WeCom] Failed to stop connector:', e))
    }
  } else if (connector.type === 'webhook-relay') {
    if (connector.enabled) {
      relay.restartOne(connector.id).catch((e) => console.error('[Relay] Failed to restart connector:', e))
    } else {
      relay.stopOne(connector.id).catch((e) => console.error('[Relay] Failed to stop connector:', e))
    }
  }
  return c.json(sanitize(connector))
})

// Test connector connectivity
app.post('/:id/test', async (c) => {
  const userId = c.get('user').sub
  const connector = await db.getConnector(c.req.param('id'), userId)
  if (!connector) return c.json({ error: 'not found' }, 404)

  switch (connector.type) {
    case 'slack': {
      const creds = connector.credentials as { bot_token?: string }
      if (!creds.bot_token) {
        return c.json({ error: 'bot_token not configured' }, 400)
      }
      try {
        const web = new WebClient(creds.bot_token)
        const auth = await web.auth.test()
        return c.json({ ok: true, detail: { team: auth.team, user: auth.user, bot_id: auth.bot_id } })
      } catch (e: any) {
        return c.json({ error: e.message || 'Slack auth failed' }, 400)
      }
    }
    default:
      return c.json({ error: `Test not supported for type: ${connector.type}` }, 400)
  }
})

// List channels (Slack only)
app.get('/:id/channels', async (c) => {
  const userId = c.get('user').sub
  const connector = await db.getConnector(c.req.param('id'), userId)
  if (!connector) return c.json({ error: 'not found' }, 404)

  if (connector.type !== 'slack') {
    return c.json({ error: 'channels listing not supported for this type' }, 400)
  }

  const creds = connector.credentials as { bot_token?: string }
  if (!creds.bot_token) {
    return c.json({ error: 'bot_token not configured' }, 400)
  }

  try {
    const web = new WebClient(creds.bot_token)
    const channels: Array<{ id: string; name: string }> = []
    let cursor: string | undefined
    do {
      const res = await web.conversations.list({
        types: 'public_channel,private_channel',
        exclude_archived: true,
        limit: 200,
        cursor,
      })
      for (const ch of res.channels || []) {
        if (ch.id && ch.name && ch.is_member) {
          channels.push({ id: ch.id, name: ch.name })
        }
      }
      cursor = res.response_metadata?.next_cursor || undefined
    } while (cursor)
    channels.sort((a, b) => a.name.localeCompare(b.name))
    return c.json(channels)
  } catch (e: any) {
    return c.json({ error: e.message || 'Failed to list channels' }, 400)
  }
})

// Delete connector
app.delete('/:id', async (c) => {
  const userId = c.get('user').sub
  const connectorId = c.req.param('id')
  const deleted = await db.deleteConnector(connectorId, userId)
  if (!deleted) return c.json({ error: 'not found' }, 404)
  slack.stopOne(connectorId).catch(() => {})
  wecom.stopOne(connectorId).catch(() => {})
  relay.stopOne(connectorId).catch(() => {})
  return c.json({ ok: true })
})

export default app
