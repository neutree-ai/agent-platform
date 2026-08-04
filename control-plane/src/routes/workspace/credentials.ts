import { Hono } from 'hono'
import type { ApiCredential } from '../../../../internal/types/api'
import type { WorkspaceAppEnv } from '../../lib/types'
import { caller, requireWorkspaceParam } from '../../middleware/workspace-auth'
import { listWorkspaceCredentials } from '../../services/db/credentials'

const credentials = new Hono<WorkspaceAppEnv>()

// The agent's own credentials, values included — this is the one route where
// they leave cp in plaintext, because the agent is what injects them.
//
// requireWorkspaceParam is what stops a token from reading any workspace but
// the one it was minted for. Without it, holding any valid token would be
// enough to walk the fleet, which is what the unauthenticated predecessor
// allowed with no token at all.
credentials.get('/v1/workspaces/:id/credentials', requireWorkspaceParam(), async (c) => {
  const { workspaceId, userId } = caller(c)

  const creds = await listWorkspaceCredentials(workspaceId, userId)
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
