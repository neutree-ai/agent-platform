import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import * as browser from '../../services/browser'
import { getPlatformToken } from '../../services/db/shares'
import { getWorkspace } from '../../services/db/workspaces'
import { textResult, waitUntil } from './shared'

export function registerBrowserTools(server: McpServer, workspaceId: string) {
  let _browserToken: string | null = null
  async function getBrowserToken(): Promise<string> {
    if (_browserToken) return _browserToken
    const ws = await getWorkspace(workspaceId)
    if (!ws) throw new Error('Workspace not found')
    const token = await getPlatformToken(ws.user_id)
    if (!token) throw new Error('No platform token for workspace owner')
    _browserToken = token
    return token
  }

  server.registerTool(
    'create_browser',
    {
      title: 'Create Browser',
      description: `Create a headless Chrome browser instance.
Returns browser_id plus connection info:
- connect_command: a ready-to-run agent-browser command — just run it as-is to start driving the browser.
- connect_url: a wss:// URL for "agent-browser connect". Do NOT pass cdp_url here.
- cdp_url: an https:// URL for Playwright only, via browser.connectOverCDP(cdp_url).
- live_view_url: share with the user so they can watch.
The browser auto-expires after the timeout (default 1 hour, max 24 hours).`,
      inputSchema: z.object({
        timeout_seconds: z
          .number()
          .optional()
          .describe('Browser timeout in seconds (default: 3600, max: 86400)'),
      }),
    },
    async ({ timeout_seconds }) => {
      try {
        const token = await getBrowserToken()
        const result = await browser.createBrowser(token, {
          timeout_seconds,
          metadata: { 'browser.workspace_id': workspaceId },
        })
        const qs = `?token=${encodeURIComponent(token)}`
        const cdpUrl = result.endpoints?.cdp ? `${result.endpoints.cdp}${qs}` : null

        // Wait for browser to be ready, then resolve WSS debugger URL
        let wssUrl: string | null = null
        if (cdpUrl) {
          console.log(`[create_browser] waiting for browser ${result.id} to be running...`)
          const ready = await waitUntil(
            async () => {
              const info = await browser.getBrowser(token, result.id)
              console.log(`[create_browser] browser ${result.id} status: ${info.status}`)
              return info.status.toLowerCase() === 'running'
            },
            { timeoutMs: 60_000 },
          )

          if (!ready) {
            console.warn(`[create_browser] browser ${result.id} did not become running within 60s`)
          } else {
            console.log(
              `[create_browser] browser ${result.id} is running, resolving CDP version...`,
            )
            const externalOrigin = new URL(cdpUrl).origin
            wssUrl = await waitUntil(
              async () => {
                const info = await browser.getCdpVersion(token, result.id)
                if (!info.webSocketDebuggerUrl) return null
                // Replace internal service host with the external hostname from endpoints.cdp
                const internal = new URL(info.webSocketDebuggerUrl)
                const external = new URL(externalOrigin)
                internal.protocol = external.protocol === 'https:' ? 'wss:' : 'ws:'
                internal.hostname = external.hostname
                internal.port = external.port
                return internal.toString()
              },
              { timeoutMs: 60_000 },
            )

            if (!wssUrl) {
              console.warn(
                `[create_browser] failed to resolve webSocketDebuggerUrl for browser ${result.id} within 60s`,
              )
            } else {
              console.log(`[create_browser] resolved wssUrl for browser ${result.id}`)
            }
          }
        }

        const liveViewUrl = result.endpoints?.live_view
          ? `${result.endpoints.live_view}${qs}`
          : null

        return textResult(
          JSON.stringify({
            browser_id: result.id,
            status: result.status,
            expires_at: result.expires_at,
            // For agent-browser: run connect_command as-is, or `agent-browser connect "<connect_url>"`.
            connect_command: wssUrl ? `agent-browser connect "${wssUrl}"` : null,
            connect_url: wssUrl,
            // For Playwright only: browser.connectOverCDP(cdp_url).
            cdp_url: cdpUrl,
            live_view_url: liveViewUrl,
            ...(wssUrl
              ? {}
              : {
                  warning:
                    'Browser created but connect_url could not be resolved within 60s. Retry create_browser, or call list_browsers to check status before connecting.',
                }),
          }),
        )
      } catch (e: any) {
        return textResult(`Error creating browser: ${e.message}`)
      }
    },
  )

  server.registerTool(
    'list_browsers',
    {
      title: 'List Browsers',
      description: 'List all active browser instances for the current user.',
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const token = await getBrowserToken()
        const result = await browser.listBrowsers(token, {
          'browser.workspace_id': workspaceId,
        })
        return textResult(JSON.stringify(result))
      } catch (e: any) {
        return textResult(`Error listing browsers: ${e.message}`)
      }
    },
  )

  server.registerTool(
    'list_browser_files',
    {
      title: 'List Browser Files',
      description: `List files inside the browser sandbox.
Defaults to /downloads — the conventional directory agents configure via CDP \`Browser.setDownloadBehavior\`.
Use after a download completes to discover what was saved. The browser sandbox is ephemeral, so files only exist while the browser is alive.
There can be a brief delay between CDP \`downloadProgress\` reporting "completed" and the file being readable; if a file looks truncated, retry after a moment.`,
      inputSchema: z.object({
        browser_id: z.string().describe('ID of the browser'),
        path: z.string().optional().describe('Directory path (default: /downloads)'),
        pattern: z.string().optional().describe('Optional glob pattern to filter results'),
      }),
    },
    async ({ browser_id, path, pattern }) => {
      try {
        const token = await getBrowserToken()
        const files = await browser.listFiles(token, browser_id, path ?? '/downloads', pattern)
        return textResult(JSON.stringify({ files }))
      } catch (e: any) {
        return textResult(`Error listing files: ${e.message}`)
      }
    },
  )

  server.registerTool(
    'get_browser_file_url',
    {
      title: 'Get Browser File Download URL',
      description: `Get a download URL for a file inside the browser sandbox.
Returns the URL alongside the current file state — use \`ready: true\` to confirm the file exists. The URL embeds an auth token and can be handed to the user (e.g. as a clickable link in chat) or fetched directly.
Files are only available while the browser is alive.`,
      inputSchema: z.object({
        browser_id: z.string().describe('ID of the browser'),
        path: z.string().describe('Full file path (e.g. /downloads/foo.pdf)'),
      }),
    },
    async ({ browser_id, path }) => {
      try {
        const token = await getBrowserToken()
        const lastSlash = path.lastIndexOf('/')
        const dir = lastSlash > 0 ? path.slice(0, lastSlash) : '/'
        const name = lastSlash >= 0 ? path.slice(lastSlash + 1) : path
        const files = await browser.listFiles(token, browser_id, dir, name)
        const match = files.find((f) => f.path === path)
        if (!match) {
          return textResult(JSON.stringify({ ready: false, path }))
        }
        return textResult(
          JSON.stringify({
            ready: true,
            url: browser.buildFileDownloadUrl(token, browser_id, path),
            path,
            size: match.size,
            modified_at: match.modifiedAt,
          }),
        )
      } catch (e: any) {
        return textResult(`Error resolving file URL: ${e.message}`)
      }
    },
  )

  server.registerTool(
    'delete_browser',
    {
      title: 'Delete Browser',
      description: 'Stop and destroy a browser instance.',
      inputSchema: z.object({
        browser_id: z.string().describe('ID of the browser to delete'),
      }),
    },
    async ({ browser_id }) => {
      try {
        const token = await getBrowserToken()
        await browser.deleteBrowser(token, browser_id)
        return textResult(`Browser ${browser_id} deleted`)
      } catch (e: any) {
        return textResult(`Error deleting browser: ${e.message}`)
      }
    },
  )
}
