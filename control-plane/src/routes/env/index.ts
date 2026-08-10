// Runner protocol endpoints (/env/v1/*).
//
// All routes are OUTBOUND calls made by a remote env-runner (behind NAT, it can
// only dial out). Auth is the env-token middleware, which yields a single
// environmentId; the scoped db layer forces every query to it. Plain Hono (not
// OpenAPIHono) — this is a machine protocol, not part of the user-facing API
// docs. The global user-auth middleware skips /env/v1/* (see index.ts).

import { Hono } from 'hono'
import type { EnvAppEnv } from '../../lib/types'
import { envAuth } from '../../middleware/env-auth'
import {
  deletePlacementForEnvironment,
  listPlacementsForEnvironment,
  recordHeartbeat,
  workspaceIsOnEnvironment,
  writeObservedForEnvironment,
} from '../../services/db/env-placements'
import { createWorkspaceToken } from '../../services/db/workspace-tokens'

const env = new Hono<EnvAppEnv>()

env.use('*', envAuth)

// Pull the desired-state snapshot for this environment.
env.get('/v1/placements', async (c) => {
  const { environmentId } = c.get('envPrincipal')
  const sinceRaw = c.req.query('since')
  const since = sinceRaw != null && sinceRaw !== '' ? Number(sinceRaw) : undefined
  if (since != null && !Number.isFinite(since)) {
    return c.json({ error: 'invalid since' }, 400)
  }
  const placements = await listPlacementsForEnvironment(environmentId, since)
  return c.json({ placements })
})

// Report observed state for one workspace.
env.post('/v1/placements/:wsId/observed', async (c) => {
  const { environmentId } = c.get('envPrincipal')
  const wsId = c.req.param('wsId')
  const body = await c.req.json().catch(() => null)
  if (!body || typeof body.phase !== 'string') {
    return c.json({ error: 'phase required' }, 400)
  }
  const ok = await writeObservedForEnvironment(environmentId, wsId, {
    phase: body.phase,
    endpoint: body.endpoint,
    message: body.message ?? null,
    version: typeof body.version === 'number' ? body.version : null,
    templateVersion: typeof body.templateVersion === 'number' ? body.templateVersion : null,
  })
  if (!ok) return c.json({ error: 'placement not found in this environment' }, 404)
  return c.json({ ok: true })
})

// Remove a placement after the workspace has been destroyed.
env.post('/v1/placements/:wsId/delete', async (c) => {
  const { environmentId } = c.get('envPrincipal')
  const wsId = c.req.param('wsId')
  const ok = await deletePlacementForEnvironment(environmentId, wsId)
  if (!ok) return c.json({ error: 'placement not found in this environment' }, 404)
  return c.json({ ok: true })
})

// Mint a workspace token for a workspace this environment is placing.
//
// The runner asks for one as it materialises the pod and hands it to the
// workload, which uses it for its own calls back into cp (/workspace/v1). cp keeps only
// the hash, so the plaintext in this response is the only copy — a runner that
// loses it asks again rather than recovering it.
//
// Scoped like every other route here: a runner can only mint for a workspace
// actually placed on its environment, so an env token cannot be turned into
// access to somebody else's workspace.
env.post('/v1/workspaces/:wsId/token', async (c) => {
  const { environmentId } = c.get('envPrincipal')
  const wsId = c.req.param('wsId')
  if (!(await workspaceIsOnEnvironment(environmentId, wsId))) {
    return c.json({ error: 'placement not found in this environment' }, 404)
  }
  const { token } = await createWorkspaceToken(wsId)
  return c.json({ token })
})

// Liveness + capability refresh.
env.post('/v1/heartbeat', async (c) => {
  const { environmentId } = c.get('envPrincipal')
  const body = await c.req.json().catch(() => null)
  const capabilities =
    body && typeof body.capabilities === 'object' && body.capabilities !== null
      ? (body.capabilities as Record<string, unknown>)
      : undefined
  await recordHeartbeat(environmentId, capabilities)
  return c.json({ ok: true })
})

export default env
