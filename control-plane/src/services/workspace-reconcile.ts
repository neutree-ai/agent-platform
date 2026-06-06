import type { ComputeResources } from '../../../internal/types/api'
import { getWorkspaceConfig, updateWorkspace } from './db/workspaces'
import * as k8s from './k8s'

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

/**
 * Bring the workspace's Deployment in line with the current desired spec:
 * template_version, agent image, and memory-fuse sidecar presence. Rebuilds
 * (delete + recreate Deployment) if any marker drifts. Returns `rebuilt: false`
 * when the workspace has no Deployment yet (caller should use createInstance).
 *
 * Drift sources:
 *   - template_version annotation < CURRENT_TEMPLATE_VERSION (structural bump)
 *   - agent image != getAgentImage(desired agent_type)
 *   - memory-fuse sidecar present != cluster provides MEMORY_FUSE_IMAGE
 *     (only surfaces on v3 pods built before sidecar became unconditional)
 *
 * The PVC and Service are preserved across rebuilds — only the Deployment is
 * replaced.
 */
export async function reconcileWorkspacePod(
  workspaceId: string,
): Promise<{ rebuilt: boolean; reason?: string }> {
  const markers = await k8s.getInstanceSpecMarkers(workspaceId)
  if (!markers) return { rebuilt: false }

  const desired = await getDesiredSpec(workspaceId)
  const desiredImage = k8s.getAgentImage(desired.agentType)
  const desiredSidecar = k8s.isMemoryFuseAvailable()

  const reasons: string[] = []
  if ((markers.templateVersion ?? 0) < k8s.CURRENT_TEMPLATE_VERSION) {
    reasons.push(`template_version ${markers.templateVersion} < ${k8s.CURRENT_TEMPLATE_VERSION}`)
  }
  if (markers.agentImage !== desiredImage) {
    reasons.push(`image ${markers.agentImage} != ${desiredImage}`)
  }
  if (markers.hasMemoryFuseSidecar !== desiredSidecar) {
    reasons.push(`memory-fuse sidecar ${markers.hasMemoryFuseSidecar} != cluster ${desiredSidecar}`)
  }

  if (reasons.length === 0) return { rebuilt: false }

  await k8s.rebuildInstance(workspaceId, desired.agentType, desired.resources)
  return { rebuilt: true, reason: reasons.join('; ') }
}

/**
 * Bring a workspace's instance up: reconcile the pod spec (rebuilds on drift),
 * apply any pending compute-resource changes, scale the Deployment to 1, and
 * optimistically mark the DB status `starting`.
 *
 * Shared by the `POST /:id/start` route and auto-start (`ensureWorkspaceRunning`).
 * Does NOT wait for readiness — the start route lets the reconcile watch flip
 * status to `running`, while auto-start polls the agent `/health` endpoint.
 */
export async function startWorkspaceInstance(
  workspaceId: string,
): Promise<{ rebuilt: boolean; reason?: string }> {
  const reconciled = await reconcileWorkspacePod(workspaceId)
  if (reconciled.rebuilt) {
    console.log(`[start ${workspaceId}] rebuilt: ${reconciled.reason}`)
    await updateWorkspace(workspaceId, { status: 'starting' })
    return reconciled
  }

  const config = await getWorkspaceConfig(workspaceId)
  const cr = config?.compute_resources
  if (cr && Object.keys(cr).length > 0) {
    await k8s.updateInstanceResources(workspaceId, cr)
    if (cr.storage) {
      await k8s.expandInstanceStorage(workspaceId, cr.storage)
    }
  }
  await k8s.startInstance(workspaceId)
  await updateWorkspace(workspaceId, { status: 'starting' })
  return { rebuilt: false }
}
