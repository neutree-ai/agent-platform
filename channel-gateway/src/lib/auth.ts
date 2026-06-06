import { verify } from 'hono/jwt'
import type { JwtPayload } from './types'

const JWT_SECRET = process.env.JWT_SECRET || 'nap-jwt-secret-change-me'

export async function verifyToken(token: string): Promise<JwtPayload | null> {
  try {
    return (await verify(token, JWT_SECRET, 'HS256')) as JwtPayload
  } catch {
    return null
  }
}
