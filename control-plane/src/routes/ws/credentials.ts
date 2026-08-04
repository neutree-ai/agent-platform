import { Hono } from 'hono'
import type { WsAppEnv } from '../../lib/types'
import { requireWorkspaceParam } from '../../middleware/ws-auth'
import { credentialsForWorkspace } from '../../services/agent-credentials'

const credentials = new Hono<WsAppEnv>()

// The agent's own credentials, values included. requireWorkspaceParam is what
// stops a token from reading any workspace but the one it was minted for —
// without it, holding any valid token would be enough to walk the fleet.
credentials.get('/v1/workspaces/:id/credentials', requireWorkspaceParam(), async (c) => {
  const creds = await credentialsForWorkspace(c.req.param('id'))
  if (!creds) return c.json({ error: 'Workspace not found' }, 404)
  return c.json(creds)
})

export default credentials
