import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/db/workspace-tokens', () => ({ verifyWorkspaceToken: vi.fn() }))
vi.mock('../../services/db/memory', () => ({
  PathConflictError: class extends Error {},
  PreconditionFailedError: class extends Error {},
  deleteMemoryByPath: vi.fn(),
  getAttachment: vi.fn(),
  getMemoryByPath: vi.fn(),
  listAttachmentsForWorkspace: vi.fn(),
  listMemories: vi.fn(),
  moveMemory: vi.fn(),
  putMemory: vi.fn(),
}))
vi.mock('../../services/memory-fuse', () => ({ broadcastStoreInvalidate: vi.fn() }))

import {
  getAttachment,
  listAttachmentsForWorkspace,
  listMemories,
  putMemory,
} from '../../services/db/memory'
import { verifyWorkspaceToken } from '../../services/db/workspace-tokens'
import ws from './index'

const verify = vi.mocked(verifyWorkspaceToken)
const attachment = vi.mocked(getAttachment)

function req(path: string, token?: string, init: RequestInit = {}) {
  return ws.request(path, {
    ...init,
    headers: { ...init.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  })
}

beforeEach(() => {
  verify.mockReset()
  attachment.mockReset()
  attachment.mockResolvedValue({ access: 'read_write' } as never)
  vi.mocked(listMemories).mockResolvedValue([] as never)
  vi.mocked(listAttachmentsForWorkspace).mockResolvedValue([] as never)
  vi.mocked(putMemory).mockResolvedValue({ path: '/a.md' } as never)
})

describe('memory routes', () => {
  it('serves the sidecar its own workspace attachments', async () => {
    verify.mockResolvedValue({ workspaceId: 'ws1', userId: 'alice' })

    const res = await req('/v1/workspaces/ws1/memory-attachments', 'ws_good')

    expect(res.status).toBe(200)
    expect(listAttachmentsForWorkspace).toHaveBeenCalledWith('ws1')
  })

  it('serves a store attached to its own workspace', async () => {
    verify.mockResolvedValue({ workspaceId: 'ws1', userId: 'alice' })

    const res = await req('/v1/workspaces/ws1/memory-stores/store1/memories', 'ws_good')

    expect(res.status).toBe(200)
    expect(attachment).toHaveBeenCalledWith('ws1', 'store1')
  })

  // The binding runs first, so a token cannot borrow another workspace's
  // attachment to reach its stores.
  it('refuses a store under another workspace before checking attachment', async () => {
    verify.mockResolvedValue({ workspaceId: 'ws1', userId: 'alice' })

    const res = await req('/v1/workspaces/ws2/memory-stores/store1/memories', 'ws_good')

    expect(res.status).toBe(404)
    expect(attachment).not.toHaveBeenCalled()
  })

  it('refuses writes to another workspace', async () => {
    verify.mockResolvedValue({ workspaceId: 'ws1', userId: 'alice' })

    const res = await req('/v1/workspaces/ws2/memory-stores/store1/memory/a.md', 'ws_good', {
      method: 'PUT',
      body: JSON.stringify({ content: 'hi' }),
    })

    expect(res.status).toBe(404)
    expect(putMemory).not.toHaveBeenCalled()
  })

  it('still refuses a store that is not attached, token and path agreeing', async () => {
    verify.mockResolvedValue({ workspaceId: 'ws1', userId: 'alice' })
    attachment.mockResolvedValue(null as never)

    const res = await req('/v1/workspaces/ws1/memory-stores/store1/memories', 'ws_good')

    expect(res.status).toBe(404)
  })

  it('keeps read-only stores read-only', async () => {
    verify.mockResolvedValue({ workspaceId: 'ws1', userId: 'alice' })
    attachment.mockResolvedValue({ access: 'read_only' } as never)

    const res = await req('/v1/workspaces/ws1/memory-stores/store1/memory/a.md', 'ws_good', {
      method: 'PUT',
      body: JSON.stringify({ content: 'hi' }),
    })

    expect(res.status).toBe(403)
    expect(putMemory).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated sidecar', async () => {
    const res = await req('/v1/workspaces/ws1/memory-stores/store1/memories')

    expect(res.status).toBe(401)
    expect(attachment).not.toHaveBeenCalled()
  })
})
