// Workspace-token codec — shared between the side that mints and the side that
// verifies.
//
// cp verifies by hashing what the caller presented and comparing; a runner mints
// and writes the hash. If those two disagreed about the hash, no token would
// ever verify, so the pair lives here rather than once per package.

import { createHash, randomBytes } from 'node:crypto'

/** Prefix that marks a workspace token, the way `env_` marks an env token. */
export const WORKSPACE_TOKEN_PREFIX = 'ws_'

/** A fresh workspace token. The plaintext is never stored — only its hash. */
export function generateWorkspaceToken(): string {
  return `${WORKSPACE_TOKEN_PREFIX}${randomBytes(32).toString('hex')}`
}

/** The at-rest form of a token: SHA-256, hex. */
export function hashWorkspaceToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
