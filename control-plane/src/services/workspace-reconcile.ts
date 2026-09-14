import type { ComputeResources } from '../../../internal/types/api'
import { hasLiveWorkspaceToken } from './db/workspace-tokens'
import { getWorkspace, getWorkspaceConfig, updateWorkspace } from './db/workspaces'
import * as k8s from './k8s'
import { bumpWorkspaceSpec, ensureReplicaFloor, setDesiredPhase } from './placement'
import { reconcileReflectSchedule } from './reflect'

interface DesiredSpec {
  agentType: string
  resources?: ComputeResources
}

async function getDesiredSpec(workspaceId: string): Promise<DesiredSpec> {
  const config = await getWorkspaceConfig(workspaceId)
  return {
    agentType: config?.agent_type || 'claude-code',
    resources: config?.compute_resources,
  }
}

interface WorkspaceDrift {
  /** Deployed template version (annotation), or null when no Deployment exists. */
  current: number | null
  /** Desired template version (CURRENT_TEMPLATE_VERSION). */
  latest: number
  /** Whether a Deployment exists for this workspace at all. */
  hasInstance: boolean
  /**
   * Human/diagnostic descriptions of each drifted marker. Empty => in sync.
   * Internal only — not surfaced to end users (they see a boolean).
   */
  reasons: string[]
}

/**
 * Read-only drift check: compare the workspace's Deployment against the
 * current desired spec (template_version, agent image, memory-fuse sidecar)
 * WITHOUT mutating anything. Shared source of truth for "is an update
 * available" — consumed by the status endpoint (read), the user-facing
 * rebuild action, and the admin batch sweep. {@link reconcileWorkspacePod}
 * is the write path built on top of it.
 *
 * Drift sources:
 *   - template_version annotation < CURRENT_TEMPLATE_VERSION (structural bump)
 *   - agent image != getAgentImage(desired agent_type)
 *   - memory-fuse sidecar present != cluster provides MEMORY_FUSE_IMAGE
 *     (only surfaces on v3 pods built before sidecar became unconditional)
 */
export async function computeWorkspaceDrift(workspaceId: string): Promise<WorkspaceDrift> {
  const latest = k8s.CURRENT_TEMPLATE_VERSION
  const markers = await k8s.getInstanceSpecMarkers(workspaceId)
  if (!markers) return { current: null, latest, hasInstance: false, reasons: [] }

  const desired = await getDesiredSpec(workspaceId)
  const desiredImage = k8s.getAgentImage(desired.agentType)
  const desiredSidecar = k8s.isMemoryFuseAvailable()

  const reasons: string[] = []
  if ((markers.templateVersion ?? 0) < latest) {
    reasons.push(`template_version ${markers.templateVersion} < ${latest}`)
  }
  if (markers.agentImage !== desiredImage) {
    reasons.push(`image ${markers.agentImage} != ${desiredImage}`)
  }
  if (markers.hasMemoryFuseSidecar !== desiredSidecar) {
    reasons.push(`memory-fuse sidecar ${markers.hasMemoryFuseSidecar} != cluster ${desiredSidecar}`)
  }

  return { current: markers.templateVersion, latest, hasInstance: true, reasons }
}

/**
 * Bring the workspace's Deployment in line with the current desired spec by
 * rebuilding (delete + recreate Deployment) when any marker drifts — see
 * {@link computeWorkspaceDrift}. Returns `rebuilt: false` when the workspace
 * has no Deployment yet (caller should use createInstance) or is already in
 * sync. The PVC and Service are preserved — only the Deployment is replaced.
 *
 * `opts.force` rebuilds even with zero drift reasons — used by
 * {@link startWorkspaceInstance} when the pod can be stale for a reason
 * drift-detection can't see (see its doc comment). `opts.forceReason` names
 * which one, so the rebuild log says why rather than just that.
 */
export async function reconcileWorkspacePod(
  workspaceId: string,
  opts: { force?: boolean; forceReason?: string } = {},
): Promise<{ rebuilt: boolean; reason?: string }> {
  const drift = await computeWorkspaceDrift(workspaceId)
  if (!drift.hasInstance) return { rebuilt: false }
  if (!opts.force && drift.reasons.length === 0) return { rebuilt: false }

  // Control inversion (P1): bump the placement spec; the env-runner re-applies
  // (rebuilds the Deployment) when the ws is running. Detection stays here (cp
  // can still read the built-in cluster's markers); the action moves to the runner.
  await bumpWorkspaceSpec(workspaceId)
  // Cache the now-desired version so the "update available" prompt clears
  // immediately, without waiting for the reconcile loop's next annotation sync.
  await updateWorkspace(workspaceId, { runtime_version: k8s.CURRENT_TEMPLATE_VERSION })
  return {
    rebuilt: true,
    reason: drift.reasons.length > 0 ? drift.reasons.join('; ') : (opts.forceReason ?? 'forced'),
  }
}

/**
 * Bring a workspace's instance up: reconcile the pod spec (rebuilds on drift),
 * apply any pending compute-resource changes, scale the Deployment to 1, and
 * optimistically mark the DB status `starting`.
 *
 * Shared by the `POST /:id/start` route and auto-start (`ensureWorkspaceRunning`).
 * Does NOT wait for readiness — the start route lets the reconcile watch flip
 * status to `running`, while auto-start polls the agent `/health` endpoint.
 *
 * Forces a pod rebuild (not just a drift-gated one) whenever the workspace has
 * no live token, or its recorded status isn't already `running`.
 * `setDesiredPhase` revokes every token of a workspace the instant it leaves
 * `running` (placement.ts), but the env-runner's actual scale-down is
 * asynchronous — the physical pod holding that now-revoked token can still be
 * alive when desired_phase flips back to running moments later (the same
 * stop+start race POST /:id/restart's own doc calls out, reachable here too via
 * idle-GC stopping a workspace and an auto-start racing right behind it). Plain
 * drift detection can't see this — the pod spec never changed, only its token
 * did — so force it rather than trust drift.reasons.
 *
 * The token check is what actually closes that race, and the status check alone
 * did not: `workspaces.status` is written by the reconcile watch, so a stop that
 * has revoked the tokens but not yet flipped the recorded status leaves a start
 * looking at `running` and skipping the rebuild. The pod then stays up for as
 * long as nothing else rebuilds it, holding a token cp rejects — its model
 * turns keep working (those never reach cp) while every call that does reach cp
 * 401s: config and credential fetches, the MCP OAuth proxy, memory refresh.
 * Failures that quiet, in a workspace that looks healthy, are what make this
 * worth a redundant rebuild on the rare false positive.
 */
export async function startWorkspaceInstance(
  workspaceId: string,
): Promise<{ rebuilt: boolean; reason?: string }> {
  const workspace = await getWorkspace(workspaceId)
  // Both conditions describe the same hazard — a pod that would come back up
  // carrying a credential cp has already revoked — from the two sides the race
  // can be observed from.
  const resuming = workspace?.status !== 'running'
  const tokenRevoked = !resuming && !(await hasLiveWorkspaceToken(workspaceId))
  // Control inversion (P1): bump spec on template drift (or when forced), then
  // set desired=running. The env-runner converges: spec drift → apply
  // (rebuild, picks up the latest config/resources baked into the spec);
  // otherwise scale the Deployment up. No separate resize call here —
  // resource changes are folded into the spec at config-edit time (PUT
  // /config bumps the spec).
  const reconciled = await reconcileWorkspacePod(workspaceId, {
    force: resuming || tokenRevoked,
    forceReason: tokenRevoked
      ? 'forced (no live workspace token)'
      : 'forced (resuming from non-running)',
  })
  if (reconciled.rebuilt) {
    console.log(`[start ${workspaceId}] rebuilt: ${reconciled.reason}`)
  }
  // Best-effort: a missing/stale Reflect schedule shouldn't block starting
  // the workspace itself.
  await reconcileReflectSchedule(workspaceId).catch((e) =>
    console.error(`[start ${workspaceId}] reflect schedule reconcile failed:`, e),
  )
  await ensureReplicaFloor(workspaceId)
  await setDesiredPhase(workspaceId, 'running')
  await updateWorkspace(workspaceId, { status: 'starting' })
  return reconciled
}
