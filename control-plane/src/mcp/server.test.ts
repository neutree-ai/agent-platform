import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../services/db/workspace-tokens', () => ({ verifyWorkspaceToken: vi.fn() }))
vi.mock('../lib/session-token', () => ({ resolveToken: vi.fn() }))
vi.mock('../services/db/teamwork', () => ({
  findTaskBySession: vi.fn(),
  getTeamworkTask: vi.fn(),
}))
vi.mock('./tools', () => ({ registerTools: vi.fn() }))

import { resolveToken } from '../lib/session-token'
import { verifyWorkspaceToken } from '../services/db/workspace-tokens'
import { handleMcpRequest } from './server'
import { registerTools } from './tools'

const verify = vi.mocked(verifyWorkspaceToken)
const register = vi.mocked(registerTools)

beforeEach(() => {
  verify.mockReset()
  register.mockReset()
  vi.mocked(resolveToken).mockReset()
})

function call(headers: Record<string, string>) {
  return handleMcpRequest(
    new Request('http://cp.test/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    }),
  )
}

describe('MCP endpoint auth', () => {
  it('rejects a request with no workspace token', async () => {
    const res = await call({ 'X-Workspace-ID': 'ws1' })

    expect(res.status).toBe(401)
    expect(verify).not.toHaveBeenCalled()
    expect(register).not.toHaveBeenCalled()
  })

  it('rejects an unknown or revoked token', async () => {
    verify.mockResolvedValue(null)

    const res = await call({ 'X-Workspace-ID': 'ws1', Authorization: 'Bearer ws_stale' })

    expect(res.status).toBe(401)
    expect(register).not.toHaveBeenCalled()
  })

  it('answers 404 for a token minted for a different workspace', async () => {
    verify.mockResolvedValue({ workspaceId: 'ws2', userId: 'bob' })

    const res = await call({ 'X-Workspace-ID': 'ws1', Authorization: 'Bearer ws_other' })

    expect(res.status).toBe(404)
    expect(register).not.toHaveBeenCalled()
  })

  it('still requires the workspace id header', async () => {
    const res = await call({ Authorization: 'Bearer ws_good' })

    expect(res.status).toBe(400)
    expect(register).not.toHaveBeenCalled()
  })

  it('serves the workspace named by a token minted for it', async () => {
    verify.mockResolvedValue({ workspaceId: 'ws1', userId: 'alice' })

    const res = await call({ 'X-Workspace-ID': 'ws1', Authorization: 'Bearer ws_good' })

    expect(res.status).toBe(200)
    expect(register).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ workspaceId: 'ws1' }),
    )
  })
})
