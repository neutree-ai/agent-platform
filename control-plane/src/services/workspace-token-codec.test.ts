import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// Subject under test lives in internal/types/workspace-token.ts (shared by cp,
// the runner and the agents); internal packages have no test runner of their
// own, so their tests live with the service that consumes them.
import {
  WORKSPACE_TOKEN_ENV,
  captureWorkspaceToken,
  generateWorkspaceToken,
  hashWorkspaceToken,
} from '../../../internal/types/workspace-token'

describe('the codec', () => {
  it('mints a distinguishable, unguessable token', () => {
    const a = generateWorkspaceToken()
    const b = generateWorkspaceToken()

    expect(a).toMatch(/^ws_[0-9a-f]{64}$/)
    expect(a).not.toBe(b)
  })

  it('hashes stably, and differently per token', () => {
    const token = generateWorkspaceToken()

    // Stable: the side that stores and the side that verifies must agree.
    expect(hashWorkspaceToken(token)).toBe(hashWorkspaceToken(token))
    expect(hashWorkspaceToken(token)).not.toBe(hashWorkspaceToken(generateWorkspaceToken()))
    expect(hashWorkspaceToken(token)).not.toContain(token)
  })
})

describe('captureWorkspaceToken', () => {
  const original = process.env[WORKSPACE_TOKEN_ENV]

  beforeEach(() => {
    process.env[WORKSPACE_TOKEN_ENV] = 'ws_from_the_runner'
  })

  afterEach(() => {
    if (original === undefined) delete process.env[WORKSPACE_TOKEN_ENV]
    else process.env[WORKSPACE_TOKEN_ENV] = original
  })

  it('returns the token and takes it out of the environment', () => {
    expect(captureWorkspaceToken()).toBe('ws_from_the_runner')

    // Deleted, not blanked: a child process inherits whatever is still there,
    // and an empty string would be inherited just as faithfully as a value.
    expect(WORKSPACE_TOKEN_ENV in process.env).toBe(false)
  })

  it('leaves nothing behind for a second reader', () => {
    captureWorkspaceToken()

    expect(captureWorkspaceToken()).toBeUndefined()
  })

  it('reports no token rather than an empty one when the runner delivered none', () => {
    delete process.env[WORKSPACE_TOKEN_ENV]

    expect(captureWorkspaceToken()).toBeUndefined()
  })

  it('treats a blank value as no token', () => {
    process.env[WORKSPACE_TOKEN_ENV] = ''

    // An optional secretKeyRef that resolves to nothing must not become a
    // literal `Bearer ` header.
    expect(captureWorkspaceToken()).toBeUndefined()
  })
})
