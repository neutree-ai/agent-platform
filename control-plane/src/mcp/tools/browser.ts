import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  type BrowserProvider,
  createNapProvider,
  providerFromEnv,
  registerBrowserTools as registerTools,
} from 'neu-browser-mcp'
import { BROWSER_SERVICE_URL } from '../../services/browser'
import { getPlatformToken } from '../../services/db/shares'
import { getWorkspace } from '../../services/db/workspaces'

/**
 * Which backend hosts the browsers, set once for the whole platform. `nap` is
 * the platform's own browser service; any other value names a hosted backend
 * that neu-browser-mcp supports and configures from its own variables (for
 * example `kernel` with `KERNEL_API_KEY`).
 */
const BROWSER_BACKEND = process.env.BROWSER_BACKEND || 'nap'

// A hosted backend has one set of credentials for the platform, so one provider
// serves every workspace. Built at startup so a bad configuration fails the
// boot instead of every later tool call.
const hostedProvider: BrowserProvider | null =
  BROWSER_BACKEND === 'nap'
    ? null
    : providerFromEnv({ ...process.env, NEU_BROWSER_BACKEND: BROWSER_BACKEND })

// Workspaces share a hosted backend's credentials, and only tags keep their
// browsers apart. A backend that cannot tag has no way to do that.
if (hostedProvider && !hostedProvider.capabilities.metadata) {
  throw new Error(
    `BROWSER_BACKEND "${BROWSER_BACKEND}" cannot tag browsers, so it cannot keep workspaces apart`,
  )
}

/** The platform's browser service acts for a user, so it is reached as the workspace owner. */
function napProvider(workspaceId: string): BrowserProvider {
  return createNapProvider({
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
  })
}

/**
 * The browser tools themselves live in neu-browser-mcp. This wires them to the
 * configured backend and confines them to the workspace: browsers are tagged
 * with it, and a tool only acts on a browser carrying the tag.
 */
export function registerBrowserTools(server: McpServer, workspaceId: string) {
  registerTools(server, {
    provider: hostedProvider ?? napProvider(workspaceId),
    scope: { 'browser.workspace_id': workspaceId },
  })
}
