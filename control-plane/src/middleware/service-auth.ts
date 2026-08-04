// Shared-secret auth for the service protocol (/svc/v1/*).
//
// For the platform's own background services — the scheduler's workers today —
// whose calls belong to no workspace and no environment, so neither of the
// narrower principals next door fits. There is nothing to scope to here: the
// key says "one of us", and routes behind it must be ones where that is
// sufficient authority.
//
// Fails closed. Without SERVICE_KEY set, every call is refused rather than
// waved through: a deployment that forgets the variable should break loudly
// where it is missing, not quietly serve an open endpoint.

import type { MiddlewareHandler } from 'hono'

export const serviceAuth: MiddlewareHandler = async (c, next) => {
  const expected = process.env.SERVICE_KEY
  if (!expected) {
    console.error('[svc] SERVICE_KEY is not set — refusing service-protocol request')
    return c.json({ error: 'Unauthorized' }, 401)
  }
  if (c.req.header('x-service-key') !== expected) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  return next()
}
