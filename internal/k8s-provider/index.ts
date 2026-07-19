// Shared Kubernetes provisioning for workspace runtimes, consumed by the
// in-process control-plane shim (control-plane/src/services/k8s.ts) and the
// standalone env-runner (env-runner-k8s). Split by concern:
//
//   config.ts         — K8sConfig + env-derived default + image helpers
//   workspace-spec.ts — pod template / Deployment construction + pure
//                       status/annotation readers
//   provider.ts       — KubernetesProvider (EnvironmentProvider impl)
//
// This index re-exports the package's public surface; import from here, not
// from the submodules.

export { type K8sConfig, getAgentImage, isMemoryFuseAvailable } from './config'
export { KubernetesProvider, makeDefaultProvider } from './provider'
export {
  CURRENT_TEMPLATE_VERSION,
  type ReconciledStatus,
  buildDeploymentSpec,
  buildHeadlessServiceSpec,
  buildStatefulSetSpec,
  buildWorkspacePodTemplate,
  deploymentTemplateVersion,
  readyReplicaIdsFromPods,
  resolveDeploymentStatus,
  resolveStatefulSetStatus,
} from './workspace-spec'
