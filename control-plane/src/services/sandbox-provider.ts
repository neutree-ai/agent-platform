import {
  type SandboxProvider,
  createNapProvider,
  providerFromEnv,
  scopeProvider,
} from 'neu-sandbox-mcp'
import { getPlatformToken } from './db/shares'
import { getWorkspace } from './db/workspaces'

const SANDBOX_SERVICE_URL = process.env.SANDBOX_SERVICE_URL || 'http://nap-sandbox:3006'

/**
 * Which backend hosts the sandboxes, set once for the whole platform. `nap` is
 * the platform's own sandbox service; any other value names a hosted backend
 * that neu-sandbox-mcp supports and configures from its own variables.
 */
const SANDBOX_BACKEND = process.env.SANDBOX_BACKEND || 'nap'

// A hosted backend has one set of credentials for the platform, so one provider
// serves every workspace. Built at startup so a bad configuration fails the
// boot instead of every later call.
const hostedProvider: SandboxProvider | null =
  SANDBOX_BACKEND === 'nap'
    ? null
    : providerFromEnv({ ...process.env, NEU_SANDBOX_BACKEND: SANDBOX_BACKEND })

// Workspaces share a hosted backend's credentials, and only tags keep their
// sandboxes apart. A backend that cannot tag has no way to do that.
if (hostedProvider && !hostedProvider.capabilities.metadata) {
  throw new Error(
    `SANDBOX_BACKEND "${SANDBOX_BACKEND}" cannot tag sandboxes, so it cannot keep workspaces apart`,
  )
}

/** The tag that marks a sandbox as created for a workspace. */
export function workspaceScope(workspaceId: string): Record<string, string> {
  return { workspace_id: workspaceId }
}

/**
 * The platform's sandbox service acts for a user, so it is reached as the
 * workspace owner, whose token is looked up on first use.
 */
function napProvider(ownerId: () => Promise<string>): SandboxProvider {
  return createNapProvider({
    baseUrl: SANDBOX_SERVICE_URL,
    // The preview subdomains hang off the sandbox service's public host.
    previewBaseUrl: process.env.SANDBOX_PUBLIC_URL || undefined,
    token: async () => {
      const token = await getPlatformToken(await ownerId())
      if (!token) throw new Error('No platform token for workspace owner')
      return token
    },
  })
}

/** The backend that holds a workspace's sandboxes, not yet confined to the workspace. */
export function sandboxProviderFor(workspaceId: string): SandboxProvider {
  return (
    hostedProvider ??
    napProvider(async () => {
      const ws = await getWorkspace(workspaceId)
      if (!ws) throw new Error('Workspace not found')
      return ws.user_id
    })
  )
}

/**
 * The workspace's sandboxes: every sandbox created through it carries the
 * workspace tag, and any other sandbox ID is reported as not found.
 */
export function workspaceSandboxes(workspace: { id: string; user_id: string }): SandboxProvider {
  const provider = hostedProvider ?? napProvider(async () => workspace.user_id)
  return scopeProvider(provider, workspaceScope(workspace.id))
}
