import type { JwtPayload } from '../services/auth'

export type AppEnv = { Variables: { user: JwtPayload } }

/**
 * Restricted principal for the BYOI runner protocol (/env/v1/*). An env token
 * resolves to exactly one environment id — never a user — and every query under
 * it is forced to that environment_id (design §9 tenant isolation).
 */
type EnvPrincipal = { environmentId: string }

export type EnvAppEnv = { Variables: { envPrincipal: EnvPrincipal } }
