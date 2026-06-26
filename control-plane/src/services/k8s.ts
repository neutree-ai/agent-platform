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
import type { ComputeResources } from '../../../internal/types/api'

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

// ── Backward-compatible function exports ──
// Thin wrappers over defaultProvider so existing call sites stay unchanged.
// New code (the env-runner) constructs its own KubernetesProvider.

export function createInstance(
  workspaceId: string,
  agentType?: string,
  resources?: ComputeResources,
) {
  return defaultProvider.createInstance(workspaceId, agentType, resources)
}

export function getInstance(workspaceId: string) {
  return defaultProvider.getInstance(workspaceId)
}

export function listInstances() {
  return defaultProvider.listInstances()
}

export function stopInstance(workspaceId: string) {
  return defaultProvider.stopInstance(workspaceId)
}

export function startInstance(workspaceId: string) {
  return defaultProvider.startInstance(workspaceId)
}

export function restartInstance(workspaceId: string) {
  return defaultProvider.restartInstance(workspaceId)
}

export function getInstanceSpecMarkers(workspaceId: string) {
  return defaultProvider.getInstanceSpecMarkers(workspaceId)
}

export function rebuildInstance(
  workspaceId: string,
  agentType: string,
  resources?: ComputeResources,
) {
  return defaultProvider.rebuildInstance(workspaceId, agentType, resources)
}

export function updateInstanceResources(workspaceId: string, resources: ComputeResources) {
  return defaultProvider.updateInstanceResources(workspaceId, resources)
}

export function expandInstanceStorage(workspaceId: string, newSize: string) {
  return defaultProvider.expandInstanceStorage(workspaceId, newSize)
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
