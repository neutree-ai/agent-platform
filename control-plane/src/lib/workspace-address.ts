import { builtinReplicaAddress, defaultCfg } from '../../../internal/k8s-provider'
import { getRemoteProxyPort } from './remote-proxy'

/**
 * Resolve the base URL cp uses to reach a workspace's agent, optionally a
 * specific replica of an auto-scaling workspace.
 *
 * This is the workspace data-plane routing seam (design §6). A built-in
 * workspace is reached via cluster DNS — the k8s address format lives in the
 * provider package ({@link builtinReplicaAddress}), so cp-core never hardcodes
 * cluster-DNS shape. `replicaId` omitted → the workspace's own Service
 * (single-replica / static, byte-identical to before); `replicaId` given → that
 * StatefulSet pod's stable per-ordinal DNS.
 *
 * A workspace on a remote (BYOI) environment is reached through that
 * environment's tunnel instead. cp keeps localhost forward proxies per reachable
 * remote workspace (lib/remote-proxy) — one per replica for an auto-scaling
 * workspace, carrying the ordinal in the tunnel meta so the runner dials the
 * right pod. This stays a synchronous O(1) map lookup — built-in workspaces are
 * never in the map, so their path is byte-identical. `replicaId` is threaded
 * through so a session-bound turn reaches its own replica; if that replica's
 * proxy isn't up yet (observe lag), the lookup misses and we fall through, which
 * fails fast rather than mis-routing the turn to another replica.
 */
export function getWorkspaceAddress(workspaceId: string, replicaId?: number): string {
  const remotePort = getRemoteProxyPort(workspaceId, replicaId)
  if (remotePort !== undefined) return `http://127.0.0.1:${remotePort}`
  return builtinReplicaAddress(defaultCfg, workspaceId, replicaId)
}

/**
 * Why a request is being routed to the workspace's agent. Call sites that act on
 * behalf of a session declare it here so session-affine routing is a change to
 * this seam only, not to its callers.
 */
interface AgentRouteContext {
  /**
   * The session this request serves (a turn, a reconnect, an interrupt). null
   * / undefined means "no session yet" (new-session chat) or a genuinely
   * workspace-scoped call — both route to the workspace's default address.
   */
  sessionId?: string | null
  /**
   * The replica (auto-scaling workspaces only) this request is bound to — the
   * session's `replica_ordinal` binding. undefined/null → the workspace's
   * default address (a static workspace, or a call with no replica affinity).
   * The binding that fills this comes from the replica router (a later stage);
   * until then every caller leaves it unset and routing is byte-identical.
   */
  replicaId?: number | null
}

/**
 * Resolve the agent base URL for a request made in `ctx`. Session-scoped
 * callers (chat turns, reconnects, interrupts, recovery) use this; purely
 * workspace-scoped callers (health, config reload, file service) may keep
 * calling {@link getWorkspaceAddress} directly — it is this function's
 * zero-context form.
 */
export function resolveAgentAddress(workspaceId: string, ctx: AgentRouteContext = {}): string {
  return getWorkspaceAddress(workspaceId, ctx.replicaId ?? undefined)
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
