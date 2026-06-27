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

import {
  type KubernetesProvider,
  type ReconciledStatus,
  makeDefaultProvider,
} from '../../../internal/k8s-provider'

export {
  CURRENT_TEMPLATE_VERSION,
  type K8sConfig,
  type ReconciledStatus,
  buildDeploymentSpec,
  deploymentTemplateVersion,
  getAgentImage,
  isMemoryFuseAvailable,
  resolveDeploymentStatus,
} from '../../../internal/k8s-provider'

/** The built-in environment's provider instance (today's only environment). */
const defaultProvider: KubernetesProvider = makeDefaultProvider()

// ── Backward-compatible read/observe wrappers ──
// Thin wrappers over defaultProvider for the cp paths that still talk to k8s
// (status reads, the delete teardown, the reconcile watch). The mutation
// wrappers (create/start/stop/restart/rebuild/resize/expand) were removed in the
// P1 control inversion — those actions now go through workspace_placements and
// the env-runner.

export function getInstance(workspaceId: string) {
  return defaultProvider.getInstance(workspaceId)
}

export function listInstances() {
  return defaultProvider.listInstances()
}

export function getInstanceSpecMarkers(workspaceId: string) {
  return defaultProvider.getInstanceSpecMarkers(workspaceId)
}

export function getInstanceStatus(workspaceId: string) {
  return defaultProvider.getInstanceStatus(workspaceId)
}

export function listWorkspaceDeployments(timeoutMs?: number) {
  return defaultProvider.listWorkspaceDeployments(timeoutMs)
}

export function watchDeployments(
  resourceVersion: string,
  onUpdate: (workspaceId: string, status: ReconciledStatus) => void,
  onError: (err: unknown) => void,
) {
  return defaultProvider.watchDeployments(resourceVersion, onUpdate, onError)
}

export function deleteInstance(workspaceId: string) {
  return defaultProvider.deleteInstance(workspaceId)
}
