import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createNapProvider, registerBrowserTools as registerTools } from 'neu-browser-mcp'
import { BROWSER_SERVICE_URL } from '../../services/browser'
import { getPlatformToken } from '../../services/db/shares'
import { getWorkspace } from '../../services/db/workspaces'

/**
 * The browser tools themselves live in neu-browser-mcp. This wires them to the
 * platform's browser service: browsers are created as the workspace owner and
 * tagged with the workspace, so each workspace only sees its own.
 */
export function registerBrowserTools(server: McpServer, workspaceId: string) {
  registerTools(server, {
    provider: createNapProvider({
      baseUrl: BROWSER_SERVICE_URL,
      // File download links are opened by users, who cannot reach the in-cluster address.
      publicBaseUrl: process.env.BROWSER_PUBLIC_URL || undefined,
      token: async () => {
        const ws = await getWorkspace(workspaceId)
        if (!ws) throw new Error('Workspace not found')
        const token = await getPlatformToken(ws.user_id)
        if (!token) throw new Error('No platform token for workspace owner')
        return token
      },
    }),
    scope: { 'browser.workspace_id': workspaceId },
  })
}
