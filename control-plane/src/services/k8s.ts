// Thin control-plane shim over the shared Kubernetes provider.
//
// The provisioning logic now lives in internal/k8s-provider so the in-process
// control plane and the standalone env-runner share one implementation (most
// importantly one buildDeploymentSpec, so both produce byte-identical pods).
// This module:
//   - re-exports the shared surface that cp call sites already import, and
//   - binds a process-local defaultProvider for the built-in environment, with
//     the historical free-function API kept as thin wrappers so the existing
//     `import * as k8s from '../services/k8s'` call sites are unchanged.

import { type KubernetesProvider, makeDefaultProvider } from '../../../internal/k8s-provider'

export {
  CURRENT_TEMPLATE_VERSION,
  type K8sConfig,
  buildDeploymentSpec,
  getAgentImage,
  isMemoryFuseAvailable,
  resolveDeploymentStatus,
  workloadTemplateVersion,
} from '../../../internal/k8s-provider'

/** The built-in environment's provider instance (today's only environment). */
const defaultProvider: KubernetesProvider = makeDefaultProvider()

// ── Read wrappers ──
// The few cp paths that still read k8s directly: a workspace's live resource
// detail, its spec markers for drift checks, the admin drift sweep, and the
// delete teardown. Everything else — provisioning, and status — goes through
// workspace_placements and the env-runner.

export function getInstanceSpecMarkers(workspaceId: string) {
  return defaultProvider.getInstanceSpecMarkers(workspaceId)
}

export function getInstanceStatus(workspaceId: string) {
  return defaultProvider.getInstanceStatus(workspaceId)
}

/**
 * Every workspace Deployment in the cluster. The admin rebuild-stale sweep reads
 * these to find workloads still running an outdated image — a question about
 * live infra detail, not about a workspace's status.
 */
export function listWorkspaceDeployments(timeoutMs?: number) {
  return defaultProvider.listWorkspaceDeployments(timeoutMs)
}

/**
 * Tear down everything belonging to a workspace, both workload shapes and the
 * volume they share a name for. Deliberately shape-independent: the workspace
 * row and its placement are deleted straight after, so anything missed here is
 * infra nothing will ever come back for.
 */
export function destroy(workspaceId: string) {
  return defaultProvider.destroy(workspaceId)
}
