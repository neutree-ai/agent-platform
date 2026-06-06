import type { JwtPayload } from '../services/auth'

export type AppEnv = { Variables: { user: JwtPayload } }
