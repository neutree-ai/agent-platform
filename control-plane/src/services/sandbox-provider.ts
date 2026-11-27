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

function positiveInt(name: string): number | null {
  const raw = process.env[name]
  if (!raw) return null
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0)
    throw new Error(`${name} must be a positive integer, not "${raw}"`)
  return n
}

/**
 * Limits on what one workspace may hold, unset by default. With a hosted
 * backend every workspace spends the platform's account, so set them there.
 */
const MAX_SANDBOXES_PER_WORKSPACE = positiveInt('SANDBOX_MAX_PER_WORKSPACE')
const MAX_LIFETIME_SECONDS = positiveInt('SANDBOX_MAX_LIFETIME_SECONDS')

/** A request the platform's sandbox limits refuse. */
export class SandboxLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SandboxLimitError'
  }
}

/** Sandboxes that still count against the limit. */
const LIVE = new Set(['creating', 'running', 'paused', 'unknown'])

/**
 * Apply the platform's limits to one workspace's provider: how many sandboxes
 * it may have at once, and how long each may live. The lifetime cap is also
 * declared as the backend's maximum, so the create tool states it.
 */
function withLimits(provider: SandboxProvider, workspaceId: string): SandboxProvider {
  if (MAX_SANDBOXES_PER_WORKSPACE == null && MAX_LIFETIME_SECONDS == null) return provider
  const { timeout } = provider.capabilities
  const maxSeconds =
    MAX_LIFETIME_SECONDS == null
      ? timeout.maxSeconds
      : Math.min(MAX_LIFETIME_SECONDS, timeout.maxSeconds ?? Number.POSITIVE_INFINITY)
  const renew = provider.renew
  return {
    ...provider,
    capabilities: {
      ...provider.capabilities,
      timeout: {
        ...timeout,
        defaultSeconds:
          maxSeconds == null
            ? timeout.defaultSeconds
            : Math.min(timeout.defaultSeconds, maxSeconds),
        maxSeconds,
      },
    },

    async create(opts) {
      if (maxSeconds != null && opts.timeoutSeconds != null && opts.timeoutSeconds > maxSeconds) {
        throw new SandboxLimitError(
          `A sandbox may live at most ${maxSeconds} seconds on this platform`,
        )
      }
      if (MAX_SANDBOXES_PER_WORKSPACE != null) {
        const live = (await provider.list({ metadata: workspaceScope(workspaceId) })).filter((s) =>
          LIVE.has(s.status),
        )
        if (live.length >= MAX_SANDBOXES_PER_WORKSPACE) {
          throw new SandboxLimitError(
            `This workspace already has ${live.length} sandboxes, the most it may have at once; kill one first`,
          )
        }
      }
      return provider.create({
        ...opts,
        timeoutSeconds:
          opts.timeoutSeconds ??
          (maxSeconds == null ? undefined : Math.min(timeout.defaultSeconds, maxSeconds)),
      })
    },

    ...(renew
      ? {
          async renew(id: string, extendSeconds: number) {
            if (maxSeconds != null) {
              const info = await provider.get(id)
              const from = Math.max(Date.parse(info?.expiresAt ?? '') || Date.now(), Date.now())
              if (from + extendSeconds * 1000 - Date.now() > maxSeconds * 1000) {
                throw new SandboxLimitError(
                  `A sandbox may have at most ${maxSeconds} seconds left on this platform`,
                )
              }
            }
            return renew.call(provider, id, extendSeconds)
          },
        }
      : {}),
  }
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
  const provider =
    hostedProvider ??
    napProvider(async () => {
      const ws = await getWorkspace(workspaceId)
      if (!ws) throw new Error('Workspace not found')
      return ws.user_id
    })
  return withLimits(provider, workspaceId)
}

/**
 * The workspace's sandboxes: every sandbox created through it carries the
 * workspace tag, and any other sandbox ID is reported as not found.
 */
export function workspaceSandboxes(workspace: { id: string; user_id: string }): SandboxProvider {
  const provider = hostedProvider ?? napProvider(async () => workspace.user_id)
  return scopeProvider(withLimits(provider, workspace.id), workspaceScope(workspace.id))
}
