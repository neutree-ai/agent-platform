import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/db/memory', () => ({ getStoreById: vi.fn() }))
vi.mock('../../services/db/messages', () => ({ getMessages: vi.fn() }))
vi.mock('../../services/db/sessions', () => ({ getSession: vi.fn(), listSessions: vi.fn() }))

import { getStoreById } from '../../services/db/memory'
import { getSession, listSessions } from '../../services/db/sessions'
import { registerReflectTools } from './reflect'

type Handler = (args: { limit?: number }) => Promise<{
  content: { text: string }[]
  isError?: boolean
}>

function listRecentActivity(sessionId: string | null): Handler {
  const server = new McpServer({ name: 't', version: '0' })
  const spy = vi.spyOn(server, 'registerTool')
  registerReflectTools(server, 'ws1', 'st1', sessionId)
  const calls = spy.mock.calls as unknown as [string, unknown, Handler][]
  const handler = calls.find(([name]) => name === 'list_recent_activity')?.[2]
  if (!handler) throw new Error('list_recent_activity not registered')
  return handler
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getStoreById).mockResolvedValue({
    last_reflected_at: '2026-11-14T03:00:00.000Z',
    created_at: '2026-09-01T00:00:00.000Z',
  } as never)
  vi.mocked(getSession).mockResolvedValue({ created_at: '2026-11-15T03:00:00.000Z' } as never)
  vi.mocked(listSessions).mockResolvedValue({ items: [] } as never)
})

describe('list_recent_activity', () => {
  it("windows the catch-up from the store checkpoint to the turn's start", async () => {
    const res = await listRecentActivity('s1')({})

    expect(getSession).toHaveBeenCalledWith('s1')
    expect(res.isError).toBeFalsy()
    expect(res.content[0].text).toContain(
      'Window: 2026-11-14T03:00:00.000Z to 2026-11-15T03:00:00.000Z',
    )
  })

  it('reports an unbound session as an error instead of guessing a window', async () => {
    const res = await listRecentActivity(null)({})

    expect(res.isError).toBe(true)
    expect(listSessions).not.toHaveBeenCalled()
  })
})
