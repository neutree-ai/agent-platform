import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { getPlatformToken } from '../../services/db/shares'
import { getWorkspace } from '../../services/db/workspaces'
import * as sandbox from '../../services/sandbox'
import { textResult } from './shared'

const SANDBOX_PUBLIC_URL = process.env.SANDBOX_PUBLIC_URL || ''

export function registerSandboxTools(server: McpServer, workspaceId: string) {
  // Cache the user's platform token (same pattern as browser tools)
  let _token: string | null = null
  async function getToken(): Promise<string> {
    if (_token) return _token
    const ws = await getWorkspace(workspaceId)
    if (!ws) throw new Error('Workspace not found')
    const token = await getPlatformToken(ws.user_id)
    if (!token) throw new Error('No platform token for workspace owner')
    _token = token
    return token
  }

  server.registerTool(
    'create_sandbox',
    {
      title: 'Create Sandbox',
      description: `Create an isolated sandbox environment with a specified container image.
Returns a sandbox_id for use with other sandbox tools.
The sandbox auto-expires after the timeout (default 1 hour).
For coding tasks (e.g. git clone, npm install, dev server), use a longer timeout like 21600 (6h) or 86400 (24h) and higher resources (cpu: "2", memory: "4Gi").`,
      inputSchema: z.object({
        image: z
          .string()
          .describe('Container image URI, e.g. "node:22-bookworm", "python:3.12-bookworm"'),
        resource: z
          .object({
            cpu: z.string().optional().describe('CPU limit, e.g. "500m", "1"'),
            memory: z.string().optional().describe('Memory limit, e.g. "512Mi", "1Gi"'),
          })
          .optional()
          .describe('Resource limits for the sandbox'),
        timeout_seconds: z
          .number()
          .optional()
          .describe(
            'Sandbox timeout in seconds (default: 3600). The sandbox auto-terminates after this duration.',
          ),
        env: z
          .array(
            z.object({
              name: z.string().describe('Variable name'),
              value: z.string().describe('Variable value'),
            }),
          )
          .optional()
          .describe('Environment variables to inject into the sandbox'),
      }),
    },
    async ({ image, resource, timeout_seconds, env }) => {
      try {
        const token = await getToken()
        const envRecord = env ? Object.fromEntries(env.map((e) => [e.name, e.value])) : undefined
        const info = await sandbox.createSandbox(token, {
          image,
          timeoutSeconds: timeout_seconds,
          resource: resource as Record<string, string> | undefined,
          env: envRecord,
          metadata: { workspace_id: workspaceId },
        })
        return textResult(
          JSON.stringify({
            sandbox_id: info.id,
            status: info.status,
            image,
            expires_at: info.expiresAt,
            created_at: info.createdAt,
          }),
        )
      } catch (e: any) {
        return textResult(`Error creating sandbox: ${e.message}`)
      }
    },
  )

  server.registerTool(
    'list_sandboxes',
    {
      title: 'List Sandboxes',
      description: 'List all sandboxes owned by the current workspace.',
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const token = await getToken()
        const result = await sandbox.listSandboxes(token, {
          metadata: { workspace_id: workspaceId },
        })
        return textResult(JSON.stringify(result))
      } catch (e: any) {
        return textResult(`Error listing sandboxes: ${e.message}`)
      }
    },
  )

  server.registerTool(
    'sandbox_run_command',
    {
      title: 'Run Command in Sandbox',
      description: `Execute a shell command inside a sandbox.
Returns stdout, stderr, exit_code, and execution_time_ms.
IMPORTANT: This command blocks until completion. For long-running processes like dev servers, run in background: "nohup npm run dev > /tmp/dev.log 2>&1 & echo $!" then use sandbox_get_preview_url to get the URL.`,
      inputSchema: z.object({
        sandbox_id: z.string().describe('ID of the target sandbox'),
        command: z
          .string()
          .describe('Shell command to execute, e.g. "python3 -c \'print(1+1)\'" or "ls -la /tmp"'),
        cwd: z.string().optional().describe('Working directory for the command'),
        timeout_seconds: z.number().optional().describe('Max execution time in seconds'),
        env: z
          .array(
            z.object({
              name: z.string().describe('Variable name'),
              value: z.string().describe('Variable value'),
            }),
          )
          .optional()
          .describe('Additional environment variables for this command'),
      }),
    },
    async ({ sandbox_id, command, cwd, timeout_seconds, env }) => {
      try {
        const token = await getToken()
        const envRecord = env ? Object.fromEntries(env.map((e) => [e.name, e.value])) : undefined
        const result = await sandbox.runCommand(token, sandbox_id, command, {
          cwd: cwd ?? undefined,
          timeoutSeconds: timeout_seconds,
          env: envRecord,
        })
        return textResult(JSON.stringify(result))
      } catch (e: any) {
        return textResult(`Error running command: ${e.message}`)
      }
    },
  )

  server.registerTool(
    'sandbox_read_file',
    {
      title: 'Read File from Sandbox',
      description: 'Read the contents of a file inside a sandbox.',
      inputSchema: z.object({
        sandbox_id: z.string().describe('ID of the target sandbox'),
        path: z.string().describe('Absolute file path inside the sandbox'),
      }),
    },
    async ({ sandbox_id, path }) => {
      try {
        const token = await getToken()
        const content = await sandbox.readFile(token, sandbox_id, path)
        return textResult(content)
      } catch (e: any) {
        return textResult(`Error reading file: ${e.message}`)
      }
    },
  )

  server.registerTool(
    'sandbox_write_files',
    {
      title: 'Write Files to Sandbox',
      description:
        'Write one or more files inside a sandbox. Creates parent directories automatically.',
      inputSchema: z.object({
        sandbox_id: z.string().describe('ID of the target sandbox'),
        files: z
          .array(
            z.object({
              path: z.string().describe('Absolute file path inside the sandbox'),
              content: z.string().describe('File content to write'),
            }),
          )
          .describe('List of files to write'),
      }),
    },
    async ({ sandbox_id, files }) => {
      try {
        const token = await getToken()
        await sandbox.writeFiles(
          token,
          sandbox_id,
          files.map((f) => ({ path: f.path, data: f.content })),
        )
        return textResult(`Successfully wrote ${files.length} file(s)`)
      } catch (e: any) {
        return textResult(`Error writing files: ${e.message}`)
      }
    },
  )

  server.registerTool(
    'sandbox_get_preview_url',
    {
      title: 'Get Sandbox Preview URL',
      description: `Get a publicly accessible preview URL for a port inside the sandbox.
Returns a subdomain URL of the form https://{id}-{port}.<sandbox-host>/ where the app runs at root /.
Use this after starting a dev server (e.g. on port 3000, 5173, 8080). The URL is publicly accessible without auth.`,
      inputSchema: z.object({
        sandbox_id: z.string().describe('ID of the target sandbox'),
        port: z
          .number()
          .describe(
            'Port number the service is listening on inside the sandbox (e.g. 3000, 5173, 8080)',
          ),
      }),
    },
    async ({ sandbox_id, port }) => {
      if (!SANDBOX_PUBLIC_URL) {
        return textResult(
          'Error getting preview URL: SANDBOX_PUBLIC_URL env var is not set on the control plane',
        )
      }
      try {
        const base = new URL(SANDBOX_PUBLIC_URL)
        const url = `${base.protocol}//${sandbox_id}-${port}.${base.host}/`
        return textResult(JSON.stringify({ sandbox_id, port, url }))
      } catch (e: any) {
        return textResult(`Error getting preview URL: ${e.message}`)
      }
    },
  )

  server.registerTool(
    'kill_sandbox',
    {
      title: 'Kill Sandbox',
      description: 'Stop and destroy a sandbox. All data inside the sandbox will be lost.',
      inputSchema: z.object({
        sandbox_id: z.string().describe('ID of the sandbox to kill'),
      }),
    },
    async ({ sandbox_id }) => {
      try {
        const token = await getToken()
        await sandbox.deleteSandbox(token, sandbox_id)
        return textResult(`Sandbox ${sandbox_id} killed`)
      } catch (e: any) {
        return textResult(`Error killing sandbox: ${e.message}`)
      }
    },
  )
}
