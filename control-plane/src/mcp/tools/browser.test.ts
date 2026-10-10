import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/db/workspaces', () => ({ getWorkspace: vi.fn() }))
vi.mock('../../services/db/shares', () => ({ getPlatformToken: vi.fn() }))

/** Load the module under a given environment and list the tools it registers. */
async function toolsUnder(env: Record<string, string>) {
  vi.resetModules()
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
  const { registerBrowserTools } = await import('./browser')

  const server = new McpServer({ name: 'test', version: '0' })
  registerBrowserTools(server, 'ws1')
  const client = new Client({ name: 'test-client', version: '0' })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(a), client.connect(b)])
  return (await client.listTools()).tools
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('browser tools backend', () => {
  it("uses the platform's own browser service by default", async () => {
    const tools = await toolsUnder({})
    expect(tools.map((t) => t.name)).toEqual([
      'create_browser',
      'list_browsers',
      'delete_browser',
      'list_browser_files',
      'get_browser_file_url',
    ])
    expect(tools[0].description).toContain('(default 1 hour, max 24 hours)')
  })

  it('uses a hosted backend when one is configured', async () => {
    const tools = await toolsUnder({ BROWSER_BACKEND: 'kernel', KERNEL_API_KEY: 'k' })
    expect(tools.map((t) => t.name)).toEqual([
      'create_browser',
      'list_browsers',
      'delete_browser',
      'list_browser_files',
      'read_browser_file',
    ])
    expect(tools[0].description).toContain('idle for the timeout (default 1 hour, max 72 hours)')
  })

  it('refuses to start on a misconfigured backend', async () => {
    await expect(toolsUnder({ BROWSER_BACKEND: 'kernel', KERNEL_API_KEY: '' })).rejects.toThrow(
      'Backend "kernel" needs KERNEL_API_KEY',
    )
    await expect(toolsUnder({ BROWSER_BACKEND: 'nope' })).rejects.toThrow(
      'Unknown NEU_BROWSER_BACKEND "nope"',
    )
    await expect(
      toolsUnder({ BROWSER_BACKEND: 'hyperbrowser', HYPERBROWSER_API_KEY: 'k' }),
    ).rejects.toThrow('cannot keep workspaces apart')
  })
})
