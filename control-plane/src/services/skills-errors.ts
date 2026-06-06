/**
 * Typed errors thrown by SkillsService.
 *
 * Routes catch and map to HTTP. Tests assert on `instanceof`. Exceptions are
 * deliberate (vs a Result type): routes have many early-return branches and
 * exceptions keep the service-level code linear.
 *
 * The BYTEA-related errors (PackageTooLargeError, UpstreamFetchError,
 * OwnedByAnotherUserError, CredentialNotFoundError) lived here pre-p1.5;
 * since the write paths moved to scs, route handlers handle those statuses
 * inline and the typed errors are gone.
 */

// 50 MiB — pre-flight Content-Length cap for cp's upload + re-upload routes.
// scs has its own copy for the actual body read; they're kept in sync by
// convention (both env-overridable via MAX_SKILL_PACKAGE_BYTES).
const MAX_SKILL_PACKAGE_BYTES = 50 * 1024 * 1024

/** Base class so callers can `instanceof SkillError` for blanket logging. */
class SkillError extends Error {
  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

/** Skill does not exist, or the caller has no visibility into it. → 404 */
export class SkillNotFoundError extends SkillError {
  constructor(message = 'Skill not found') {
    super(message)
  }
}

/** Authenticated but lacks the permission for the requested op. → 403 */
export class NotAllowedError extends SkillError {
  constructor(message = 'Not allowed') {
    super(message)
  }
}

/**
 * Input violated a service-level rule (visibility/grants pairing, empty
 * body). → 400. `details` carries structured context the route may want
 * to forward (e.g. `candidates` for a multi-skill-repo git import).
 */
export class InvalidInputError extends SkillError {
  readonly details?: Record<string, unknown>
  constructor(message?: string, details?: Record<string, unknown>) {
    super(message ?? 'Invalid input')
    this.details = details
  }
}

/**
 * Operation would leave the system in an inconsistent state (e.g. shrinking
 * visibility while other users' workspaces still depend on the skill). → 409
 */
export class ConflictError extends SkillError {}

export { MAX_SKILL_PACKAGE_BYTES }
