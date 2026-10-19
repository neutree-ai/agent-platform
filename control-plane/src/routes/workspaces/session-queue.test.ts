import { OpenAPIHono } from '@hono/zod-openapi'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppEnv } from '../../lib/types'

vi.mock('../../lib/workspace-access', () => ({
  canAccessWorkspace: vi.fn().mockResolvedValue(true),
}))
vi.mock('../../services/db/workspaces', () => ({
  getWorkspace: vi.fn().mockResolvedValue({ id: 'ws' }),
}))
vi.mock('../../services/db/sessions', () => ({ getSession: vi.fn() }))
vi.mock('../../services/db/session-message-queue', () => ({ enqueueSessionMessage: vi.fn() }))
vi.mock('../../services/chat/message-queue', () => ({
  drainSessionMessageQueue: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../services/chat/executeChat', () => ({ executeChat: vi.fn() }))

const { default: sessions } = await import('./sessions')
const { getSession } = await import('../../services/db/sessions')
const { enqueueSessionMessage } = await import('../../services/db/session-message-queue')
const { canAccessWorkspace } = await import('../../lib/workspace-access')
const app = new OpenAPIHono<AppEnv>()
app.use('*', async (c, next) => {
  c.set('user', { sub: 'caller' } as never)
  await next()
})
app.route('/api/workspaces', sessions)
const send = (body: unknown) =>
  app.request('/api/workspaces/ws/sessions/s1/queue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'action-1' },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(canAccessWorkspace).mockResolvedValue(true)
  vi.mocked(getSession).mockResolvedValue({
    id: 's1',
    workspace_id: 'ws',
    status: 'active',
  } as never)
  vi.mocked(enqueueSessionMessage).mockResolvedValue('1')
})

describe('POST session queue', () => {
  it('accepts a connector follow-up with the authenticated caller and idempotency key', async () => {
    const response = await send({ message: 'approved', source: 'webhook', callerUserId: 'spoofed' })
    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ session_id: 's1', queue_id: '1', status: 'queued' })
    expect(enqueueSessionMessage).toHaveBeenCalledWith('s1', 'action-1', {
      message: 'approved',
      images: [],
      source: 'webhook',
      callerUserId: 'caller',
    })
  })

  it('rejects inaccessible workspaces and cross-workspace or inactive sessions before writing', async () => {
    vi.mocked(canAccessWorkspace).mockResolvedValueOnce(false)
    expect((await send({ message: 'hello' })).status).toBe(404)
    vi.mocked(getSession).mockResolvedValueOnce({
      workspace_id: 'other',
      status: 'active',
    } as never)
    expect((await send({ message: 'hello' })).status).toBe(404)
    vi.mocked(getSession).mockResolvedValueOnce({ workspace_id: 'ws', status: 'archived' } as never)
    expect((await send({ message: 'hello' })).status).toBe(404)
    expect(enqueueSessionMessage).not.toHaveBeenCalled()
  })

  it('reports a reused key with different content and rejects an invalid source', async () => {
    vi.mocked(enqueueSessionMessage).mockResolvedValueOnce(null)
    expect((await send({ message: 'changed' })).status).toBe(409)
    expect((await send({ message: 'hello', source: 'invented' })).status).toBe(400)
    expect(enqueueSessionMessage).toHaveBeenCalledTimes(1)
  })
})
