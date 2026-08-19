import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/db/workspace-tokens', () => ({ verifyWorkspaceToken: vi.fn() }))
vi.mock('../../services/db/workspaces', () => ({
  getWorkspace: vi.fn(),
  getWorkspaceConfig: vi.fn(),
}))
vi.mock('../../services/db/users', () => ({ getUser: vi.fn() }))
vi.mock('../../services/db/memory', () => ({
  getMemoryByPath: vi.fn(),
  listAttachmentsForWorkspace: vi.fn(),
}))
vi.mock('../../services/mcp-oauth', () => ({ getToken: vi.fn(), serverOriginFromUrl: vi.fn() }))

import { getMemoryByPath, listAttachmentsForWorkspace } from '../../services/db/memory'
import { getUser } from '../../services/db/users'
import { verifyWorkspaceToken } from '../../services/db/workspace-tokens'
import { getWorkspace, getWorkspaceConfig } from '../../services/db/workspaces'
import ws from './index'

const verify = vi.mocked(verifyWorkspaceToken)
const config = vi.mocked(getWorkspaceConfig)

function get(path: string, token?: string) {
  return ws.request(path, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined)
}

beforeEach(() => {
  vi.mocked(getWorkspace).mockResolvedValue({ id: 'ws1', user_id: 'alice' } as never)
  vi.mocked(getUser).mockResolvedValue({ username: 'alice', display_name: 'Alice' } as never)
  vi.mocked(listAttachmentsForWorkspace).mockResolvedValue([] as never)
  vi.mocked(getMemoryByPath).mockResolvedValue(null as never)
  config.mockReset()
  config.mockResolvedValue({
    agent_type: 'claude-code',
    model: 'claude-opus-5',
    api_key: 'sk-provider-secret',
    system_prompt: 'be helpful',
    mcp_config: '{}',
  } as never)
  verify.mockReset()
})

describe('GET /workspace/v1/workspaces/:id/config', () => {
  it('serves the workspace its own config', async () => {
    verify.mockResolvedValue({ workspaceId: 'ws1', userId: 'alice' })

    const res = await get('/v1/workspaces/ws1/config', 'ws_good')

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ model: 'claude-opus-5', agent_type: 'claude-code' })
  })

  // The config carries the provider api_key, so the binding matters as much
  // here as it does for credentials.
  it('refuses to serve another workspace, valid token or not', async () => {
    verify.mockResolvedValue({ workspaceId: 'ws1', userId: 'alice' })

    const res = await get('/v1/workspaces/ws2/config', 'ws_good')

    expect(res.status).toBe(404)
    expect(config).not.toHaveBeenCalled()
  })

  it('rejects a request with no token', async () => {
    const res = await get('/v1/workspaces/ws1/config')

    expect(res.status).toBe(401)
    expect(config).not.toHaveBeenCalled()
  })

  // A switched-off server stays in the workspace config so it can be switched
  // back on, but it must never be handed to the agent.
  it('withholds disabled MCP servers from the agent', async () => {
    verify.mockResolvedValue({ workspaceId: 'ws1', userId: 'alice' })
    config.mockResolvedValue({
      agent_type: 'claude-code',
      mcp_config: JSON.stringify({
        mcpServers: {
          live: { type: 'http', url: 'https://example.com/mcp' },
          paused: { type: 'http', url: 'https://paused.example.com/mcp', disabled: true },
        },
      }),
    } as never)

    const res = await get('/v1/workspaces/ws1/config', 'ws_good')

    const served = JSON.parse((await res.json()).mcp_config)
    expect(Object.keys(served.mcpServers)).toEqual(['live'])
  })

  it('404s when the workspace has no config', async () => {
    verify.mockResolvedValue({ workspaceId: 'ws1', userId: 'alice' })
    config.mockResolvedValue(null as never)

    const res = await get('/v1/workspaces/ws1/config', 'ws_good')

    expect(res.status).toBe(404)
  })
})
