import { Hono } from 'hono'
import type { ApiCredential } from '../../../../internal/types/api'
import type { WsAppEnv } from '../../lib/types'
import { requireWorkspaceParam } from '../../middleware/ws-auth'
import { listWorkspaceCredentials } from '../../services/db/credentials'
import { getWorkspace } from '../../services/db/workspaces'

const credentials = new Hono<WsAppEnv>()

// The agent's own credentials, values included — this is the one route where
// they leave cp in plaintext, because the agent is what injects them.
//
// requireWorkspaceParam is what stops a token from reading any workspace but
// the one it was minted for. Without it, holding any valid token would be
// enough to walk the fleet, which is what the unauthenticated predecessor
// allowed with no token at all.
credentials.get('/v1/workspaces/:id/credentials', requireWorkspaceParam(), async (c) => {
  const id = c.req.param('id')
  const workspace = await getWorkspace(id)
  if (!workspace) return c.json({ error: 'Workspace not found' }, 404)

  const creds = await listWorkspaceCredentials(id, workspace.user_id)
  const response: ApiCredential[] = creds.map((cr) => ({
    name: cr.name,
    value: cr.value,
    inject: cr.inject,
    path: cr.path,
    mode: cr.mode,
    scope: cr.scope,
    status: cr.status,
  }))
  return c.json(response)
})

export default credentials
