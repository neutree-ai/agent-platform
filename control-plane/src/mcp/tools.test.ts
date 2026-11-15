import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./tools/afs', () => ({ registerAfsTools: vi.fn() }))
vi.mock('./tools/agent', () => ({ registerAgentTools: vi.fn() }))
vi.mock('./tools/browser', () => ({ registerBrowserTools: vi.fn() }))
vi.mock('./tools/builder-mode', () => ({ registerBuilderTools: vi.fn() }))
vi.mock('./tools/export-file-url', () => ({ registerExportFileUrlTool: vi.fn() }))
vi.mock('./tools/memory', () => ({ registerMemoryTools: vi.fn() }))
vi.mock('./tools/reflect', () => ({ registerReflectTools: vi.fn() }))
vi.mock('./tools/sandbox', () => ({ registerSandboxTools: vi.fn() }))
vi.mock('./tools/skills', () => ({ registerSkillsTools: vi.fn() }))

import { registerTools } from './tools'
import { registerMemoryTools } from './tools/memory'
import { registerReflectTools } from './tools/reflect'

const server = {} as McpServer
const base = {
  workspaceId: 'ws1',
  sessionId: null,
  taskId: null,
  reflectStoreId: null,
  headers: new Headers(),
}

beforeEach(() => vi.clearAllMocks())

describe('registerTools', () => {
  it('serves the Reflect toolset before the turn has bound its session', () => {
    registerTools(server, { ...base, reflectStoreId: 'st1' })

    expect(registerReflectTools).toHaveBeenCalledWith(server, 'ws1', 'st1', null)
    expect(registerMemoryTools).not.toHaveBeenCalled()
  })

  it('serves the normal toolset outside a Reflect turn', () => {
    registerTools(server, { ...base, sessionId: 's1' })

    expect(registerReflectTools).not.toHaveBeenCalled()
    expect(registerMemoryTools).toHaveBeenCalledWith(server, 'ws1')
  })
})
