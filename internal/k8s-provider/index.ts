// Shared Kubernetes provisioning for workspace runtimes, consumed by the
// in-process control-plane shim (control-plane/src/services/k8s.ts) and the
// standalone env-runner (env-runner-k8s). Split by concern:
//
//   config.ts               — K8sConfig + env-derived default + image helpers
//   workspace-spec.ts       — pod template / workload construction + pure
//                             status/annotation readers, shared by both shapes
//   workload.ts             — WorkspaceWorkload, the shape-independent surface
//   static-workload.ts      — Deployment + ClusterIP Service
//   auto-scaling-workload.ts— StatefulSet + headless Service + shared RWX volume
//   provider.ts             — KubernetesProvider: the facade that picks a shape
//
// This index re-exports the package's public surface; import from here, not
// from the submodules.

export { type K8sConfig, defaultCfg, getAgentImage, isMemoryFuseAvailable } from './config'
export {
  type InstanceSpecMarkers,
  type K8sResourceStatus,
  KubernetesProvider,
  makeDefaultProvider,
} from './provider'
export type { WorkspaceWorkload } from './workload'
export {
  AGENT_PORT,
  CURRENT_TEMPLATE_VERSION,
  DEFAULT_WORKSPACE_RESOURCES,
  buildDeploymentSpec,
  buildHeadlessServiceSpec,
  buildStatefulSetSpec,
  buildWorkspacePodTemplate,
  builtinHeadlessAddress,
  builtinReplicaAddress,
  workloadTemplateVersion,
  readyReplicaIdsFromPods,
  resolveDeploymentStatus,
  resolveStatefulSetStatus,
} from './workspace-spec'
