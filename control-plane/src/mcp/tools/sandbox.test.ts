import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/db/workspaces', () => ({
  getWorkspace: vi.fn(async () => ({ id: 'ws1', user_id: 'u1' })),
}))
vi.mock('../../services/db/shares', () => ({
  getPlatformToken: vi.fn(async () => 'platform-token'),
}))
// The platform's sandbox service, reached over HTTP: answers that every sandbox
// belongs to ws1, and records each exec it is sent.
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)
vi.mock('../../services/db/export-tokens', () => ({
  createExportToken: vi.fn(async () => ({ token: 'exp123' })),
  deleteExportToken: vi.fn(async () => true),
}))
vi.mock('../../lib/dufs', () => ({ classifyDufsPath: vi.fn() }))
vi.mock('../../lib/workspace-address', () => ({ getWorkspaceAddress: () => 'http://ws1.agents' }))

const exportTokens = await import('../../services/db/export-tokens')
const dufs = await import('../../lib/dufs')

let execResult = { stdout: '12\n', stderr: '', exitCode: 0 }
const execs: { url: string; auth: string | null; body: any }[] = []

function json(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
}

/** Load the tools under a given environment and return a connected client. */
async function clientUnder(env: Record<string, string>) {
  vi.resetModules()
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
  const { registerSandboxTools } = await import('./sandbox')

  const server = new McpServer({ name: 'test', version: '0' })
  registerSandboxTools(server, 'ws1')
  const client = new Client({ name: 'test-client', version: '0' })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(a), client.connect(b)])
  return client
}

async function upload(client: Client, args: Record<string, unknown>) {
  const res = (await client.callTool({ name: 'sandbox_upload_directory', arguments: args })) as {
    content: { text: string }[]
    isError?: boolean
  }
  return { text: res.content[0].text, isError: res.isError ?? false }
}

const FILES = { FILES_PUBLIC_URL: 'https://files.example.com/x' }

beforeEach(() => {
  vi.mocked(dufs.classifyDufsPath).mockResolvedValue('dir')
  execResult = { stdout: '12\n', stderr: '', exitCode: 0 }
  execs.length = 0
  fetchMock.mockImplementation(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input)
    if (url.pathname.endsWith('/exec')) {
      execs.push({
        url: url.pathname,
        auth: new Headers(init.headers).get('authorization'),
        body: JSON.parse(String(init.body)),
      })
      return json(execResult)
    }
    const id = url.pathname.split('/')[3]
    return json({ id, status: { state: 'Running' }, metadata: { workspace_id: 'ws1' } })
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('sandbox_upload_directory', () => {
  it('has the sandbox pull the directory zip through a short-lived export token', async () => {
    vi.mocked(dufs.classifyDufsPath).mockImplementation(async (url) =>
      url.endsWith('/files/films/intro') ? 'dir' : null,
    )
    const client = await clientUnder(FILES)
    const res = await upload(client, {
      sandbox_id: 'sbx1',
      path: '/workspace/films/intro/',
      dest: '/home/user/films/intro',
    })

    expect(res).toEqual({
      text: JSON.stringify({ dest: '/home/user/films/intro', files_in_dest: 12 }),
      isError: false,
    })
    expect(dufs.classifyDufsPath).toHaveBeenCalledWith('http://ws1.agents/files/films/intro')
    expect(exportTokens.createExportToken).toHaveBeenCalledWith('ws1', 'films/intro', 300, 'dir')
    expect(execs[0].url).toBe('/api/sandboxes/sbx1/exec')
    expect(execs[0].auth).toBe('Bearer platform-token')
    const command = execs[0].body.command
    expect(command).toContain("'https://files.example.com/x/exp123/?zip'")
    expect(command).toContain("-d '/home/user/films/intro'")
    expect(command).not.toContain("rm -rf '/home")
    expect(exportTokens.deleteExportToken).toHaveBeenCalledWith('ws1', 'exp123')
  })

  it('clears dest first when asked to replace', async () => {
    const client = await clientUnder(FILES)
    await upload(client, { sandbox_id: 'sbx1', path: 'src', dest: '/app', replace: true })
    expect(execs[0].body.command).toContain("rm -rf '/app'")
  })

  it('revokes the token and reports stderr when the sandbox command fails', async () => {
    execResult = { stdout: '', stderr: 'curl: (6) Could not resolve host\n', exitCode: 6 }
    const client = await clientUnder(FILES)
    const res = await upload(client, { sandbox_id: 'sbx1', path: 'src', dest: '/app' })

    expect(res.isError).toBe(true)
    expect(res.text).toBe('Error uploading directory (exit 6): curl: (6) Could not resolve host')
    expect(exportTokens.deleteExportToken).toHaveBeenCalledWith('ws1', 'exp123')
  })

  it('refuses a file, a missing path and a path that climbs out', async () => {
    const client = await clientUnder(FILES)

    vi.mocked(dufs.classifyDufsPath).mockResolvedValue('file')
    expect((await upload(client, { sandbox_id: 's', path: 'a.txt', dest: '/a' })).text).toBe(
      'Error: /workspace/a.txt is a file, not a directory',
    )

    vi.mocked(dufs.classifyDufsPath).mockResolvedValue(null)
    expect((await upload(client, { sandbox_id: 's', path: 'gone', dest: '/a' })).text).toBe(
      'Error: directory not found at /workspace/gone',
    )

    expect((await upload(client, { sandbox_id: 's', path: 'a/../..', dest: '/a' })).text).toBe(
      'Error: path must not contain ".."',
    )
    expect(exportTokens.createExportToken).not.toHaveBeenCalled()
  })

  it('needs the files public URL', async () => {
    const client = await clientUnder({})
    const res = await upload(client, { sandbox_id: 's', path: 'src', dest: '/app' })
    expect(res.text).toBe('Error: FILES_PUBLIC_URL env var is not set on the control plane')
  })
})

describe('sandbox tools', () => {
  it('registers the package tools plus the upload tool, with previews when configured', async () => {
    const client = await clientUnder({ SANDBOX_PUBLIC_URL: 'https://sandbox.example.com' })
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toContain('create_sandbox')
    expect(names).toContain('sandbox_get_command_logs')
    expect(names).toContain('sandbox_get_preview_url')
    expect(names.at(-1)).toBe('sandbox_upload_directory')
  })

  it('refuses a sandbox of another workspace', async () => {
    fetchMock.mockImplementation(async () =>
      json({ id: 'other', status: { state: 'Running' }, metadata: { workspace_id: 'ws2' } }),
    )
    const client = await clientUnder(FILES)
    const res = await upload(client, { sandbox_id: 'other', path: 'src', dest: '/app' })
    expect(res).toEqual({
      text: 'Error uploading directory: Sandbox other not found',
      isError: true,
    })
    expect(execs).toHaveLength(0)
  })
})

describe('uploadDirectoryCommand', () => {
  it('quotes the URL and dest for the shell', async () => {
    const { uploadDirectoryCommand } = await import('./sandbox')
    const command = uploadDirectoryCommand('https://f/t/?zip', "/home/user/it's here", false)
    expect(command).toContain(`-d '/home/user/it'\\''s here'`)
  })
})
