import { getRemoteProxyPort } from './remote-proxy'

const NAMESPACE = process.env.K8S_NAMESPACE || 'default'
const AGENT_PORT = 3001

/** Cluster-DNS address of a workspace on the built-in environment. */
function builtinAddress(workspaceId: string): string {
  return `http://tos-${workspaceId}.${NAMESPACE}.svc.cluster.local:${AGENT_PORT}`
}

/**
 * Resolve the base URL cp uses to reach a workspace's agent.
 *
 * This is the workspace data-plane routing seam (design §6). In v1 every
 * workspace lives on the built-in environment and is reached via cluster DNS —
 * so this stays a synchronous, zero-cost call, identical to before.
 *
 * A workspace on a remote (BYOI) environment is reached through that
 * environment's tunnel instead of cluster DNS. cp keeps a localhost forward
 * proxy per reachable remote workspace (lib/remote-proxy); this stays a
 * synchronous O(1) map lookup — built-in workspaces are never in the map, so
 * their path is byte-identical (cluster DNS, zero extra cost). The proxy
 * lifecycle (set up on observe-running, torn down on stop) is driven elsewhere.
 */
export function getWorkspaceAddress(workspaceId: string): string {
  const remotePort = getRemoteProxyPort(workspaceId)
  if (remotePort !== undefined) return `http://127.0.0.1:${remotePort}`
  return builtinAddress(workspaceId)
}

/**
 * Why a request is being routed to the workspace's agent. A workspace runs
 * exactly one replica today, so every context resolves to the same address —
 * but call sites that act on behalf of a session declare it here, so that the
 * day a workspace runs more than one replica, session-affine routing is a
 * change to this function only, not to its callers.
 */
interface AgentRouteContext {
  /**
   * The session this request serves (a turn, a reconnect, an interrupt). null
   * / undefined means "no session yet" (new-session chat) or a genuinely
   * workspace-scoped call — both route to the workspace's default address.
   */
  sessionId?: string | null
}

/**
 * Resolve the agent base URL for a request made in `ctx`. Session-scoped
 * callers (chat turns, reconnects, interrupts, recovery) use this; purely
 * workspace-scoped callers (health, config reload, file service) may keep
 * calling {@link getWorkspaceAddress} directly — it is this function's
 * zero-context form.
 */
export function resolveAgentAddress(workspaceId: string, _ctx: AgentRouteContext = {}): string {
  return getWorkspaceAddress(workspaceId)
}

type ReloadScope = 'config' | 'skills' | 'credentials'

// A reload triggers the agent's full loadSkills(), which round-trips to scs +
// touches NFS per skill — observed at 5–16s for a handful of skills, so the
// timeout must clear a normal reload comfortably or it false-fails healthy
// agents (which then retry forever and re-fan-out the ones that succeeded).
// This only guards against a genuinely stuck agent pinning a fanout slot; a
// timeout counts as a failed reload, which the skill-reload queue retries.
const RELOAD_TIMEOUT_MS = 60_000

/**
 * POST JSON to a running agent's endpoint with a timeout. Returns the Response,
 * or null if the agent is unreachable / timed out (caller decides what that
 * means). Shared by the reload and usage-pull paths.
 */
export async function postToAgent(
  workspaceId: string,
  path: string,
  body: unknown,
  timeoutMs: number,
): Promise<Response | null> {
  try {
    return await fetch(`${getWorkspaceAddress(workspaceId)}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    return null
  }
}

/** Notify a running agent to reload specific scopes. Returns true if agent acknowledged. */
export async function notifyAgentReload(
  workspaceId: string,
  scope: ReloadScope[],
): Promise<boolean> {
  const resp = await postToAgent(workspaceId, '/reload-config', { scope }, RELOAD_TIMEOUT_MS)
  return resp?.ok ?? false
}
