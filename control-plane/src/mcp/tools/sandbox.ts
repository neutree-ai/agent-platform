import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { getPlatformToken } from '../../services/db/shares'
import { getWorkspace } from '../../services/db/workspaces'
import * as sandbox from '../../services/sandbox'
import { errorResult, jsonResult, textResult } from './shared'

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
        resource_requests: z
          .object({
            cpu: z.string().optional().describe('CPU request, e.g. "100m"'),
            memory: z.string().optional().describe('Memory request, e.g. "128Mi"'),
          })
          .optional()
          .describe(
            'Resource requests, reserved against node capacity. Defaults to the same values as `resource` (limits). Set them lower for a sandbox that idles between bursts, so it stops holding its full limit. Ignored by older sandbox runtimes, in which case requests stay equal to limits.',
          ),
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
    async ({ image, resource, resource_requests, timeout_seconds, env }) => {
      try {
        const token = await getToken()
        const envRecord = env ? Object.fromEntries(env.map((e) => [e.name, e.value])) : undefined
        const info = await sandbox.createSandbox(token, {
          image,
          timeoutSeconds: timeout_seconds,
          resource: resource as Record<string, string> | undefined,
          resourceRequests: resource_requests as Record<string, string> | undefined,
          env: envRecord,
          metadata: { workspace_id: workspaceId },
        })
        return jsonResult({
          sandbox_id: info.id,
          status: info.status,
          image,
          expires_at: info.expiresAt,
          created_at: info.createdAt,
        })
      } catch (e: any) {
        return errorResult(`Error creating sandbox: ${e.message}`)
      }
    },
  )

  server.registerTool(
    'sandbox_renew',
    {
      title: 'Renew Sandbox',
      description:
        'Extend a sandbox expiry. Use this instead of creating a replacement when a task runs longer than the original timeout.',
      inputSchema: z.object({
        sandbox_id: z.string().describe('ID of the target sandbox'),
        timeout_seconds: z
          .number()
          .describe('New lifetime in seconds, counted from now (e.g. 3600 for one more hour)'),
      }),
    },
    async ({ sandbox_id, timeout_seconds }) => {
      try {
        const token = await getToken()
        const result = await sandbox.renewSandbox(token, sandbox_id, timeout_seconds)
        return jsonResult({ sandbox_id, expires_at: result.expiresAt })
      } catch (e: any) {
        return errorResult(`Error renewing sandbox: ${e.message}`)
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
        return jsonResult(result)
      } catch (e: any) {
        return errorResult(`Error listing sandboxes: ${e.message}`)
      }
    },
  )

  server.registerTool(
    'sandbox_run_command',
    {
      title: 'Run Command in Sandbox',
      description: `Execute a shell command inside a sandbox.
Returns stdout, stderr, exit_code, and execution_time_ms.
By default this blocks until the command exits. For anything long-running (dev servers, builds, watchers) pass background: true — it returns a command_id immediately, which you follow with sandbox_get_command_logs / sandbox_get_command_status and can stop with sandbox_interrupt_command. Then use sandbox_get_preview_url to reach a server you started.`,
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
        background: z
          .boolean()
          .optional()
          .describe(
            'Return as soon as the command starts instead of waiting for it to exit. stdout/stderr come back empty; poll with the returned command_id.',
          ),
      }),
    },
    async ({ sandbox_id, command, cwd, timeout_seconds, env, background }) => {
      try {
        const token = await getToken()
        const envRecord = env ? Object.fromEntries(env.map((e) => [e.name, e.value])) : undefined
        const result = await sandbox.runCommand(token, sandbox_id, command, {
          cwd: cwd ?? undefined,
          timeoutSeconds: timeout_seconds,
          env: envRecord,
          background,
        })
        return jsonResult(result)
      } catch (e: any) {
        return errorResult(`Error running command: ${e.message}`)
      }
    },
  )

  server.registerTool(
    'sandbox_get_command_status',
    {
      title: 'Get Background Command Status',
      description:
        'Check whether a background command is still running. Returns running, exit_code, and timing.',
      inputSchema: z.object({
        sandbox_id: z.string().describe('ID of the target sandbox'),
        command_id: z.string().describe('command_id returned by sandbox_run_command'),
      }),
    },
    async ({ sandbox_id, command_id }) => {
      try {
        const token = await getToken()
        return jsonResult(await sandbox.getCommandStatus(token, sandbox_id, command_id))
      } catch (e: any) {
        return errorResult(`Error getting command status: ${e.message}`)
      }
    },
  )

  server.registerTool(
    'sandbox_get_command_logs',
    {
      title: 'Get Background Command Logs',
      description: `Fetch output from a background command.
Returns { content, cursor }. Pass the cursor back on the next call to get only what was written since — polling from cursor 0 every time re-reads the whole log and will eventually blow past the tool output limit.`,
      inputSchema: z.object({
        sandbox_id: z.string().describe('ID of the target sandbox'),
        command_id: z.string().describe('command_id returned by sandbox_run_command'),
        cursor: z
          .number()
          .optional()
          .describe('Cursor from the previous call. Omit or use 0 to read from the start.'),
      }),
    },
    async ({ sandbox_id, command_id, cursor }) => {
      try {
        const token = await getToken()
        return jsonResult(await sandbox.getCommandLogs(token, sandbox_id, command_id, cursor))
      } catch (e: any) {
        return errorResult(`Error getting command logs: ${e.message}`)
      }
    },
  )

  server.registerTool(
    'sandbox_interrupt_command',
    {
      title: 'Interrupt Command',
      description:
        'Stop a running background command. The command ends with a non-zero exit code and a "signal: terminated" error.',
      inputSchema: z.object({
        sandbox_id: z.string().describe('ID of the target sandbox'),
        command_id: z.string().describe('command_id returned by sandbox_run_command'),
      }),
    },
    async ({ sandbox_id, command_id }) => {
      try {
        const token = await getToken()
        await sandbox.interruptCommand(token, sandbox_id, command_id)
        return jsonResult({ success: true, command_id })
      } catch (e: any) {
        return errorResult(`Error interrupting command: ${e.message}`)
      }
    },
  )

  server.registerTool(
    'sandbox_read_file',
    {
      title: 'Read File from Sandbox',
      description: `Read the contents of a file inside a sandbox.
Reads the whole file by default. For a large file, page through it with offset/limit instead — an oversized read gets truncated on the way back to you, and you will not be told where it was cut.`,
      inputSchema: z.object({
        sandbox_id: z.string().describe('ID of the target sandbox'),
        path: z.string().describe('Absolute file path inside the sandbox'),
        offset: z.number().optional().describe('Starting line number, 1-based'),
        limit: z.number().optional().describe('Number of lines to read from offset'),
      }),
    },
    async ({ sandbox_id, path, offset, limit }) => {
      try {
        const token = await getToken()
        const content = await sandbox.readFile(token, sandbox_id, path, { offset, limit })
        return textResult(content)
      } catch (e: any) {
        return errorResult(`Error reading file: ${e.message}`)
      }
    },
  )

  server.registerTool(
    'sandbox_list_directory',
    {
      title: 'List Sandbox Directory',
      description: `List a directory inside a sandbox. Each entry carries a type (file / directory / symlink).
Use depth to walk subdirectories. To find a file by name rather than list a directory, use sandbox_search_files.`,
      inputSchema: z.object({
        sandbox_id: z.string().describe('ID of the target sandbox'),
        path: z.string().describe('Absolute directory path inside the sandbox'),
        depth: z
          .number()
          .optional()
          .describe('Traversal depth; defaults to 1 (immediate children only)'),
      }),
    },
    async ({ sandbox_id, path, depth }) => {
      try {
        const token = await getToken()
        return jsonResult({ files: await sandbox.listDirectory(token, sandbox_id, path, depth) })
      } catch (e: any) {
        return errorResult(`Error listing directory: ${e.message}`)
      }
    },
  )

  server.registerTool(
    'sandbox_search_files',
    {
      title: 'Search Files in Sandbox',
      description:
        'Find files under a directory by glob pattern (e.g. "*.py"). Returns a flat list.',
      inputSchema: z.object({
        sandbox_id: z.string().describe('ID of the target sandbox'),
        path: z.string().describe('Base directory to search from'),
        pattern: z.string().optional().describe('Glob pattern, e.g. "*.log"'),
      }),
    },
    async ({ sandbox_id, path, pattern }) => {
      try {
        const token = await getToken()
        return jsonResult({ files: await sandbox.searchFiles(token, sandbox_id, path, pattern) })
      } catch (e: any) {
        return errorResult(`Error searching files: ${e.message}`)
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
        return errorResult(`Error writing files: ${e.message}`)
      }
    },
  )

  server.registerTool(
    'sandbox_delete_files',
    {
      title: 'Delete Files from Sandbox',
      description: 'Delete one or more files. For directories use sandbox_delete_directories.',
      inputSchema: z.object({
        sandbox_id: z.string().describe('ID of the target sandbox'),
        paths: z.array(z.string()).describe('Absolute file paths to delete'),
      }),
    },
    async ({ sandbox_id, paths }) => {
      try {
        const token = await getToken()
        await sandbox.deleteFiles(token, sandbox_id, paths)
        return jsonResult({ success: true, count: paths.length })
      } catch (e: any) {
        return errorResult(`Error deleting files: ${e.message}`)
      }
    },
  )

  server.registerTool(
    'sandbox_move_files',
    {
      title: 'Move or Rename Files in Sandbox',
      description: 'Move or rename files and directories inside a sandbox.',
      inputSchema: z.object({
        sandbox_id: z.string().describe('ID of the target sandbox'),
        entries: z
          .array(
            z.object({
              src: z.string().describe('Current absolute path'),
              dest: z.string().describe('New absolute path'),
            }),
          )
          .describe('Move operations to apply'),
      }),
    },
    async ({ sandbox_id, entries }) => {
      try {
        const token = await getToken()
        await sandbox.moveFiles(token, sandbox_id, entries)
        return jsonResult({ success: true, count: entries.length })
      } catch (e: any) {
        return errorResult(`Error moving files: ${e.message}`)
      }
    },
  )

  server.registerTool(
    'sandbox_create_directories',
    {
      title: 'Create Directories in Sandbox',
      description:
        'Create directories. Not needed before sandbox_write_files, which creates parents on its own.',
      inputSchema: z.object({
        sandbox_id: z.string().describe('ID of the target sandbox'),
        paths: z.array(z.string()).describe('Absolute directory paths to create'),
      }),
    },
    async ({ sandbox_id, paths }) => {
      try {
        const token = await getToken()
        await sandbox.createDirectories(
          token,
          sandbox_id,
          paths.map((p) => ({ path: p })),
        )
        return jsonResult({ success: true, count: paths.length })
      } catch (e: any) {
        return errorResult(`Error creating directories: ${e.message}`)
      }
    },
  )

  server.registerTool(
    'sandbox_delete_directories',
    {
      title: 'Delete Directories from Sandbox',
      description: 'Delete directories and everything inside them.',
      inputSchema: z.object({
        sandbox_id: z.string().describe('ID of the target sandbox'),
        paths: z.array(z.string()).describe('Absolute directory paths to delete'),
      }),
    },
    async ({ sandbox_id, paths }) => {
      try {
        const token = await getToken()
        await sandbox.deleteDirectories(token, sandbox_id, paths)
        return jsonResult({ success: true, count: paths.length })
      } catch (e: any) {
        return errorResult(`Error deleting directories: ${e.message}`)
      }
    },
  )

  server.registerTool(
    'sandbox_replace_contents',
    {
      title: 'Replace Text in Sandbox Files',
      description: `Replace text inside files, editing in place instead of rewriting the whole file.
Returns a replaced_count per file — 0 means the old text was not found, so check it rather than assuming the edit landed.
If detail_available is false the sandbox runtime is too old to report counts: the replacement still happened, but you have to read the file back to confirm what changed.`,
      inputSchema: z.object({
        sandbox_id: z.string().describe('ID of the target sandbox'),
        entries: z
          .array(
            z.object({
              path: z.string().describe('Absolute file path'),
              old_content: z.string().describe('Text to find'),
              new_content: z.string().describe('Text to replace it with'),
            }),
          )
          .describe('Replacements to apply'),
      }),
    },
    async ({ sandbox_id, entries }) => {
      try {
        const token = await getToken()
        const { results, detailAvailable } = await sandbox.replaceContents(
          token,
          sandbox_id,
          entries.map((e) => ({
            path: e.path,
            oldContent: e.old_content,
            newContent: e.new_content,
          })),
        )
        return jsonResult({
          results: results.map((r) => ({ path: r.path, replaced_count: r.replacedCount })),
          detail_available: detailAvailable,
        })
      } catch (e: any) {
        return errorResult(`Error replacing contents: ${e.message}`)
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
        return errorResult(
          'Error getting preview URL: SANDBOX_PUBLIC_URL env var is not set on the control plane',
        )
      }
      try {
        const base = new URL(SANDBOX_PUBLIC_URL)
        const url = `${base.protocol}//${sandbox_id}-${port}.${base.host}/`
        return textResult(JSON.stringify({ sandbox_id, port, url }))
      } catch (e: any) {
        return errorResult(`Error getting preview URL: ${e.message}`)
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
        return errorResult(`Error killing sandbox: ${e.message}`)
      }
    },
  )
}
