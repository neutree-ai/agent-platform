import { createHash, randomBytes } from 'node:crypto'

/** Generate a random service token (returned to user once) */
export function generateToken(): string {
  return `tos_${randomBytes(32).toString('hex')}`
}

/** Hash a token for storage/lookup (SHA-256) */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
