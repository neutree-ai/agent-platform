import { Hono } from 'hono'
import type { AppEnv } from '../lib/types'
import * as db from '../services/db'

const sessions = new Hono<AppEnv>()

/** Build a source URL from connector type and channel/thread info */
function buildSourceUrl(source: db.SessionSource): string | null {
  if (source.connector_type === 'slack') {
    const teamUrl = (source.connector_metadata as Record<string, unknown>)?.team_url as string | undefined
    if (!teamUrl) return null
    // Slack permalink: https://<team>.slack.com/archives/<channel>/p<ts_without_dot>
    const base = teamUrl.replace(/\/$/, '')
    const tsNoDot = source.thread_id.replace('.', '')
    return `${base}/archives/${source.channel_id}/p${tsNoDot}`
  }
  return null
}

// GET /api/sessions/:sessionId/source
sessions.get('/:sessionId/source', async (c) => {
  const sessionId = c.req.param('sessionId')
  const source = await db.getSessionSource(sessionId)
  if (!source) {
    return c.json({ error: 'No channel source found for this session' }, 404)
  }

  return c.json({
    type: source.connector_type,
    connector_name: source.connector_name,
    channel_id: source.channel_id,
    thread_id: source.thread_id,
    route_name: source.route_name,
    url: buildSourceUrl(source),
  })
})

export default sessions
