import {
  builtinHeadlessAddress,
  builtinReplicaAddress,
  defaultCfg,
} from '../../../internal/k8s-provider'
import { assertNever } from '../../../internal/types/runtime-mode'
import { anyReadyReplica, readyReplicaIds, runtimeModeOf } from '../services/replica-router'
import { getRemoteProxyPort } from './remote-proxy'

/**
 * Resolve the base URL cp uses to reach a workspace's agent, optionally a
 * specific replica of it.
 *
 * This is the workspace data-plane routing seam, and the one place the two
 * runtime shapes are addressed differently — a difference in the *shape* of the
 * address, which no amount of replica bookkeeping can paper over:
 *
 * - `'static'` — one pod behind a ClusterIP Service. The Service IS the address,
 *   so a replica id is meaningless here and is ignored: there is exactly one
 *   replica and the Service already points at it.
 * - `'auto-scaling'` — no ClusterIP Service at all (a VIP would round-robin
 *   across replicas and defeat session affinity). A named replica resolves to
 *   that StatefulSet pod's stable per-ordinal DNS; with none named, any ready
 *   replica serves (they share the volume). While nothing is ready yet — scaled
 *   to zero, cold-starting, not yet observed — it resolves to the HEADLESS
 *   Service, whose DNS names pods as k8s marks them ready, so the first health
 *   poll and the first turn land the moment a pod comes up rather than waiting
 *   for cp's next observation.
 *
 * A workspace cp has not polled yet has no known shape; it is addressed by its
 * Service, which is what a workspace has unless it is auto-scaling.
 *
 * The k8s address formats live in the provider package, so cp-core never
 * hardcodes cluster-DNS shape.
 *
 * A workspace on a remote (BYOI) environment is reached through that
 * environment's tunnel instead, and that lookup comes first. cp keeps localhost
 * forward proxies per reachable remote workspace (lib/remote-proxy) — one per
 * replica, carrying the ordinal in the tunnel meta so the runner dials the right
 * pod. It stays a synchronous O(1) map lookup that built-in workspaces always
 * miss. `replicaId` is threaded through so a session-bound turn reaches its own
 * replica; if that replica's proxy isn't up yet, the lookup misses and we fall
 * through, which fails fast rather than mis-routing the turn elsewhere.
 */
export function getWorkspaceAddress(workspaceId: string, replicaId?: number): string {
  const remotePort = getRemoteProxyPort(workspaceId, replicaId)
  if (remotePort !== undefined) return `http://127.0.0.1:${remotePort}`

  const mode = runtimeModeOf(workspaceId)
  switch (mode) {
    case 'auto-scaling': {
      const id = replicaId ?? anyReadyReplica(workspaceId)
      return id === undefined
        ? builtinHeadlessAddress(defaultCfg, workspaceId)
        : builtinReplicaAddress(defaultCfg, workspaceId, id)
    }
    case 'static':
    case undefined:
      return builtinReplicaAddress(defaultCfg, workspaceId)
    default:
      return assertNever(mode)
  }
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
   * The replica this request is bound to — the session's `replica_ordinal`.
   * undefined/null → a call with no replica affinity, which takes the
   * workspace's default address.
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
 * — unlike the shared workspace volume — is per-process. Every ready replica has
 * to be reloaded, or the ones missed keep serving stale config, so we fan out
 * over the ready set and require all to ack; a partial failure returns false and
 * the caller (e.g. the skill-reload queue) retries. With nothing reported ready
 * — a stopped workspace, or one cp has not observed yet — the fan-out collapses
 * to a single call to the workspace's default address.
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
