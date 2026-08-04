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

/**
 * Row id for a minted token. Both writers — cp and the built-in runner, which
 * has its own pool — go through this, so one table does not end up carrying two
 * id shapes depending on who inserted the row.
 */
export function newWorkspaceTokenId(): string {
  return randomBytes(8).toString('hex')
}

/** The at-rest form of a token: SHA-256, hex. */
export function hashWorkspaceToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** The env var a runner delivers the token in. */
export const WORKSPACE_TOKEN_ENV = 'WORKSPACE_TOKEN'

/**
 * Take the workspace token out of the environment and return it.
 *
 * For a process that spawns things it does not control — an agent server
 * starting a coding CLI, which in turn runs shell commands written by a model.
 * The token is the server's credential for talking to cp, not something the CLI
 * or anything under it has any use for, so it is removed from process.env before
 * the first child is spawned rather than being inherited by all of them. This is
 * the mirror image of how user credentials are handled: those are deliberately
 * pushed *into* the child environment, because they are exactly what the model's
 * shell is meant to use.
 *
 * Worth being clear about the limit: this keeps the token out of the child's
 * environment and out of anything reading `process.env`, not out of reach of a
 * process that goes looking in /proc for the parent's original environment.
 * It raises the cost of an accidental leak; it is not a boundary.
 *
 * Call once, at startup, before anything is spawned.
 */
export function captureWorkspaceToken(): string | undefined {
  const token = process.env[WORKSPACE_TOKEN_ENV]
  // biome-ignore lint/performance/noDelete: the variable must be gone, not undefined — a child would inherit "undefined" as a value
  delete process.env[WORKSPACE_TOKEN_ENV]
  return token || undefined
}
