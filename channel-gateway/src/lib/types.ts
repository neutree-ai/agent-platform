export interface JwtPayload {
  sub: string // db user id
  username: string
  name: string
  exp: number
  [key: string]: unknown
}

export type AppEnv = { Variables: { user: JwtPayload } }
