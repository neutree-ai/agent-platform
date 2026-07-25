import { builtinReplicaAddress, defaultCfg } from '../../../internal/k8s-provider'
import { anyReadyReplica, readyReplicaIds } from '../services/replica-router'
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
 *
 * With no `replicaId`, a workspace-scoped call (health, reload, usage, export):
 * a static workspace resolves to its single Service (unchanged); a built-in
 * auto-scaling one has NO ClusterIP Service — only per-ordinal headless DNS — so
 * it resolves to any one ready replica (all share the volume). Falls back to the
 * bare name only when no replica is ready (scaled to zero / not yet observed),
 * where nothing is reachable anyway.
 */
export function getWorkspaceAddress(workspaceId: string, replicaId?: number): string {
  const remotePort = getRemoteProxyPort(workspaceId, replicaId)
  if (remotePort !== undefined) return `http://127.0.0.1:${remotePort}`
  const id = replicaId ?? anyReadyReplica(workspaceId)
  return builtinReplicaAddress(defaultCfg, workspaceId, id)
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
 * means). Shared by the reload and usage-pull paths. `replicaId` targets one
 * replica of an auto-scaling workspace; omit it for a workspace-scoped call
 * (any ready replica — usage reads the shared transcripts, so any answers).
 */
export async function postToAgent(
  workspaceId: string,
  path: string,
  body: unknown,
  timeoutMs: number,
  replicaId?: number,
): Promise<Response | null> {
  try {
    return await fetch(`${getWorkspaceAddress(workspaceId, replicaId)}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    return null
  }
}

/**
 * Notify a running agent to reload specific scopes. Returns true if the agent
 * acknowledged.
 *
 * A reload mutates the agent's IN-MEMORY config/skills/credentials cache, which
 * — unlike the shared workspace volume — is per-process. So an auto-scaling
 * workspace must reload EVERY ready replica, or the ones missed keep serving
 * stale config. We fan out and require all to ack; a partial failure returns
 * false so the caller (e.g. the skill-reload queue) retries. A static workspace
 * has no ready set → the single default-address call, unchanged.
 */
export async function notifyAgentReload(
  workspaceId: string,
  scope: ReloadScope[],
): Promise<boolean> {
  const replicas = readyReplicaIds(workspaceId)
  if (replicas.length === 0) {
    const resp = await postToAgent(workspaceId, '/reload-config', { scope }, RELOAD_TIMEOUT_MS)
    return resp?.ok ?? false
  }
  const results = await Promise.all(
    replicas.map((id) =>
      postToAgent(workspaceId, '/reload-config', { scope }, RELOAD_TIMEOUT_MS, id),
    ),
  )
  return results.every((r) => r?.ok ?? false)
}
