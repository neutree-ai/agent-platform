import type { JwtPayload } from '../services/auth'

export type AppEnv = { Variables: { user: JwtPayload } }

/**
 * Restricted principal for the BYOI runner protocol (/env/v1/*). An env token
 * resolves to exactly one environment id — never a user — and every query under
 * it is forced to that environment_id (design §9 tenant isolation).
 */
type EnvPrincipal = { environmentId: string }

export type EnvAppEnv = { Variables: { envPrincipal: EnvPrincipal } }

/**
 * Restricted principal for the workspace protocol (/workspace/v1/*). A workspace
 * token resolves to exactly one workspace, narrower than an env principal, which
 * covers a whole environment. Routes carrying a workspace id in the path must
 * match it against this one (see requireWorkspaceParam), so a token that leaks
 * out of its pod still cannot read another workspace.
 *
 * `userId` is the workspace's owner, carried because verifying the token already
 * reads the row — it is not authority in its own right, and nothing here may act
 * on a user beyond what owning this workspace implies.
 */
type WorkspacePrincipal = { workspaceId: string; userId: string }

export type WorkspaceAppEnv = { Variables: { workspacePrincipal: WorkspacePrincipal } }
