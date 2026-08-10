/**
 * Route-level tests for GET /api/workspaces/:id/sessions/:sessionId/usage.
 *
 * Strategy: mock the db and settle layers so this exercises only what the
 * handler itself decides — which caller may read an account, what counts as a
 * session worth answering for, and the response shape. The completeness rule
 * has its own tests in services/usage/settle.test.ts.
 *
 * The two authorisation paths are the point. Both are specific to this route:
 * the ledger outlives the workspace, so a deleted workspace falls back to the
 * owner stamped on its rows, and a session nobody has heard of must not read
 * back as a settled zero.
 */
import { OpenAPIHono } from '@hono/zod-openapi'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getWorkspace: vi.fn(),
  getSession: vi.fn(),
  getSessionUsage: vi.fn(),
  getSessionUsageOwner: vi.fn(),
  settleSessionUsage: vi.fn(),
}))

vi.mock('../../services/db/workspaces', () => ({ getWorkspace: mocks.getWorkspace }))
vi.mock('../../services/db/workspace-usage', () => ({
  getSessionUsage: mocks.getSessionUsage,
  getSessionUsageOwner: mocks.getSessionUsageOwner,
}))
vi.mock('../../services/usage/settle', () => ({ settleSessionUsage: mocks.settleSessionUsage }))
vi.mock('../../services/db/sessions', () => ({
  getSession: mocks.getSession,
  clearPendingMessage: vi.fn(),
  deleteSession: vi.fn(),
  renameSession: vi.fn(),
  setPendingMessage: vi.fn(),
  setSessionStarred: vi.fn(),
}))
vi.mock('../../services/db/pool', () => ({ pool: { query: vi.fn() } }))

import sessionRoutes from '../workspaces/sessions'

const FAKE_USER = {
  sub: 'alice',
  username: 'alice',
  name: 'Alice',
  role: 'user' as const,
  exp: Math.floor(Date.now() / 1000) + 3600,
}

function makeApp(): OpenAPIHono {
  const app = new OpenAPIHono()
  app.use('*', async (c, next) => {
    ;(c as unknown as { set: (k: string, v: unknown) => void }).set('user', FAKE_USER)
    await next()
  })
  app.route('/api/workspaces', sessionRoutes as unknown as OpenAPIHono)
  return app
}

const URL = '/api/workspaces/ws-1/sessions/sess-1/usage'

const TOTALS = {
  input_tokens: 120,
  output_tokens: 34,
  cache_read_tokens: 5_000,
  cache_creation_tokens: 40,
  cache_creation_5m_tokens: 0,
  cache_creation_1h_tokens: 40,
  reasoning_output_tokens: 7,
  web_search_requests: 0,
  record_count: 3,
}

const USAGE = {
  totals: TOTALS,
  by_model: [{ ...TOTALS, source: 'codex', model: 'gpt-5.5' }],
  first_ts: '2026-08-10T06:00:00.000Z',
  last_ts: '2026-08-10T06:40:44.000Z',
}

const SETTLEMENT = {
  complete: true,
  drained_through: '2026-08-10T06:40:55.000Z',
  activity_at: '2026-08-10T06:40:44.000Z',
  reason: null,
}

describe('GET /workspaces/:id/sessions/:sessionId/usage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getWorkspace.mockResolvedValue({ id: 'ws-1', user_id: 'alice', is_system: false })
    mocks.getSessionUsageOwner.mockResolvedValue('alice')
    mocks.getSessionUsage.mockResolvedValue(USAGE)
    mocks.settleSessionUsage.mockResolvedValue(SETTLEMENT)
  })

  it('returns the totals, the per-model split and the settlement', async () => {
    const res = await makeApp().request(URL)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ session_id: 'sess-1', ...USAGE, settlement: SETTLEMENT })
  })

  it('reads the totals after settling, so a pull it triggered is included', async () => {
    const order: string[] = []
    mocks.settleSessionUsage.mockImplementation(async () => {
      order.push('settle')
      return SETTLEMENT
    })
    mocks.getSessionUsage.mockImplementation(async () => {
      order.push('read')
      return USAGE
    })

    await makeApp().request(URL)
    expect(order).toEqual(['settle', 'read'])
  })

  it('reports an unsettled account as it stands', async () => {
    const pending = { ...SETTLEMENT, complete: false, reason: 'pending_settle' }
    mocks.settleSessionUsage.mockResolvedValue(pending)

    const res = await makeApp().request(URL)
    expect(res.status).toBe(200)
    expect((await res.json()).settlement).toEqual(pending)
  })

  it('hides a workspace the caller does not own', async () => {
    mocks.getWorkspace.mockResolvedValue({ id: 'ws-1', user_id: 'bob', is_system: false })

    const res = await makeApp().request(URL)
    expect(res.status).toBe(404)
    expect(mocks.getSessionUsage).not.toHaveBeenCalled()
  })

  it('answers for a deleted workspace when the ledger names the caller', async () => {
    // The whole point of a ledger with no foreign key: a caller that recycles
    // its workspace after a run can still read what the run cost.
    mocks.getWorkspace.mockResolvedValue(null)
    mocks.getSessionUsageOwner.mockResolvedValue('alice')

    const res = await makeApp().request(URL)
    expect(res.status).toBe(200)
    expect((await res.json()).totals).toEqual(TOTALS)
  })

  it('hides a deleted workspace whose ledger names someone else', async () => {
    mocks.getWorkspace.mockResolvedValue(null)
    mocks.getSessionUsageOwner.mockResolvedValue('bob')

    expect((await makeApp().request(URL)).status).toBe(404)
  })

  it('hides a deleted workspace that left no ledger rows', async () => {
    mocks.getWorkspace.mockResolvedValue(null)
    mocks.getSessionUsageOwner.mockResolvedValue(null)

    expect((await makeApp().request(URL)).status).toBe(404)
  })

  it('404s an unknown session instead of reporting a free one', async () => {
    // A mistyped id summing to zero would read exactly like a run that cost
    // nothing, which is the one answer a caller comparing runs must not get.
    mocks.getSessionUsageOwner.mockResolvedValue(null)
    mocks.getSession.mockResolvedValue(null)

    const res = await makeApp().request(URL)
    expect(res.status).toBe(404)
    expect(mocks.getSessionUsage).not.toHaveBeenCalled()
  })

  it('404s a session belonging to another workspace', async () => {
    mocks.getSessionUsageOwner.mockResolvedValue(null)
    mocks.getSession.mockResolvedValue({ id: 'sess-1', workspace_id: 'ws-2' })

    expect((await makeApp().request(URL)).status).toBe(404)
  })

  it('answers for a live session that has not spent anything yet', async () => {
    mocks.getSessionUsageOwner.mockResolvedValue(null)
    mocks.getSession.mockResolvedValue({ id: 'sess-1', workspace_id: 'ws-1' })

    expect((await makeApp().request(URL)).status).toBe(200)
  })
})
