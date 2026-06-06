import { Hono } from 'hono'
import { slackSend, slackSetStatus } from '../connectors/slack-sender'
import { wecomSend, wecomSendStream } from '../connectors/wecom-sender'
import * as db from '../services/db'

const app = new Hono()

interface SendRequest {
  route_id: string
  reply_to?: Record<string, unknown>
  text?: string
  stream?: { content: string; finish: boolean }
}

// POST /internal/connectors/:id/send — internal endpoint for scheduler, no auth
app.post('/:id/send', async (c) => {
  const connectorId = c.req.param('id')
  const body = await c.req.json<SendRequest>()

  if (!body.route_id) {
    return c.json({ error: 'route_id is required' }, 400)
  }
  if (!body.stream && !body.text) {
    return c.json({ error: 'text or stream is required' }, 400)
  }

  const connector = await db.getConnector(connectorId)
  if (!connector) return c.json({ error: 'connector not found' }, 404)
  if (!connector.enabled) return c.json({ error: 'connector is disabled' }, 400)

  const route = await db.getRoute(body.route_id)
  if (!route || route.connector_id !== connectorId) {
    return c.json({ error: 'route not found' }, 404)
  }

  // Streaming path: only wecom supports it today; other connectors fall back
  // to a single send on `finish=true` (delta accumulation done client-side).
  if (body.stream) {
    if (connector.type !== 'wecom') {
      return c.json({ error: `streaming not supported for connector type: ${connector.type}` }, 400)
    }
    try {
      await wecomSendStream(connector, route, body.reply_to, body.stream)
    } catch (e: any) {
      console.error(
        `[CG] Failed to stream via connector=${connectorId} route=${body.route_id}:`,
        e?.message ?? e,
      )
      return c.json({ error: e?.message ?? 'wecom stream send failed' }, 500)
    }
    // Only log a send event on the final frame to avoid log spam.
    if (body.stream.finish) {
      await db.logEvent({
        route_id: route.id,
        connector_id: connector.id,
        event_type: 'send',
        payload: { stream: true, reply_to: body.reply_to },
        status: 'success',
      })
    }
    return c.json({ ok: true })
  }

  switch (connector.type) {
    case 'slack':
      try {
        await slackSend(connector, route, body.text!, body.reply_to)
      } catch (e: any) {
        console.error(
          `[CG] Failed to send via connector=${connectorId} route=${body.route_id}:`,
          e?.data?.error ?? e?.message ?? e,
        )
        return c.json({ error: e?.data?.error ?? e?.message ?? 'slack send failed' }, 500)
      }
      break
    case 'wecom':
      // handleMessage always opens a stream placeholder for inbound replies to
      // satisfy WeCom's 5s passive-reply window. Convert the final text reply
      // to a stream-finish frame so it lands in the same bubble and consumes
      // the req_id cleanly. Falls back to passive markdown when no req_id is
      // available (proactive sends without an inbound trigger).
      try {
        if (body.reply_to?.req_id) {
          await wecomSendStream(connector, route, body.reply_to, {
            content: body.text!,
            finish: true,
          })
        } else {
          await wecomSend(connector, route, body.text!, body.reply_to)
        }
      } catch (e: any) {
        console.error(
          `[CG] Failed to send via connector=${connectorId} route=${body.route_id}:`,
          e?.message ?? e,
        )
        return c.json({ error: e?.message ?? 'wecom send failed' }, 500)
      }
      break
    default:
      return c.json({ error: `unsupported connector type: ${connector.type}` }, 400)
  }

  await db.logEvent({
    route_id: route.id,
    connector_id: connector.id,
    event_type: 'send',
    payload: { text: body.text, reply_to: body.reply_to },
    status: 'success',
  })

  return c.json({ ok: true })
})

// POST /internal/connectors/:id/status — set thread status for Slack assistant
app.post('/:id/status', async (c) => {
  const connectorId = c.req.param('id')
  const body = await c.req.json<{ channel_id: string; thread_ts: string; status: string }>()

  if (!body.channel_id || !body.thread_ts) {
    return c.json({ error: 'channel_id and thread_ts are required' }, 400)
  }

  const connector = await db.getConnector(connectorId)
  if (!connector) return c.json({ error: 'connector not found' }, 404)

  if (connector.type === 'slack') {
    try {
      await slackSetStatus(connector, body.channel_id, body.thread_ts, body.status || '')
    } catch (e) {
      console.error(`[CG] Failed to set status for connector=${connectorId}:`, e)
      return c.json({ error: 'failed to set status' }, 500)
    }
  }

  return c.json({ ok: true })
})

export default app
