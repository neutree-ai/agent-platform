// Workspace-token auth middleware for the workspace protocol (/workspace/v1/*).
//
// Guards calls a workspace's own workloads make back into cp — the agent server
// and the memory-fuse / afs sidecars. Resolves a Bearer workspace token to a
// RESTRICTED principal ({ workspaceId }) — deliberately not a user, and
// narrower than the env principal next door, which covers a whole environment.
//
// Holding a valid token is not by itself permission to read a given workspace:
// every route whose path carries a workspace id must also apply
// requireWorkspaceParam, so the id being asked for and the id the token was
// minted for have to agree.

import type { Context, MiddlewareHandler } from 'hono'
import type { WorkspaceAppEnv } from '../lib/types'
import { verifyWorkspaceToken } from '../services/db/workspace-tokens'

export const workspaceAuth: MiddlewareHandler<WorkspaceAppEnv> = async (c, next) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  const principal = await verifyWorkspaceToken(authHeader.slice(7))
  if (!principal) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  c.set('workspacePrincipal', principal)
  return next()
}

/**
 * Bind a route's workspace path param to the caller's own workspace.
 *
 * A middleware rather than a helper the handler calls, because a check the
 * handler has to remember is a check that eventually gets forgotten — this way
 * an unbound route is visible at the route declaration.
 *
 * Answers 404, not 403: a caller asking about someone else's workspace learns
 * nothing about whether it exists. Same shape the /api routes use for a
 * canManage miss.
 *
 * @param param name of the path parameter holding the workspace id — routes use
 *              both `:id` and `:wsId`.
 */
export function requireWorkspaceParam(param = 'id'): MiddlewareHandler<WorkspaceAppEnv> {
  return async (c, next) => {
    const requested = c.req.param(param)
    if (!requested || c.get('workspacePrincipal').workspaceId !== requested) {
      return c.json({ error: 'Workspace not found' }, 404)
    }
    return next()
  }
}

/** The calling workspace's id. Only valid downstream of {@link workspaceAuth}. */
export function callerWorkspaceId(c: Context<WorkspaceAppEnv>): string {
  return c.get('workspacePrincipal').workspaceId
}
