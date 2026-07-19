// Infra configuration for the Kubernetes provider: the K8sConfig shape, its
// process.env-derived default, and image-resolution helpers. Split from the
// provider so spec-building (workspace-spec.ts) and lifecycle (provider.ts)
// can share one config seam.

const NAMESPACE = process.env.K8S_NAMESPACE || 'default'
const AGENT_IMAGE_PREFIX = process.env.AGENT_IMAGE_PREFIX || 'nap-agent'
const AGENT_IMAGE_TAG = process.env.AGENT_IMAGE_TAG || 'latest'
const AGENT_STORAGE_CLASS = process.env.AGENT_STORAGE_CLASS || 'nfs-csi'
const IMAGE_PULL_SECRET = process.env.IMAGE_PULL_SECRET || ''
const AGENT_NODE_SELECTOR: Record<string, string> | undefined =
  process.env.AGENT_NODE_SELECTOR === undefined
    ? { 'cape.infrastructure.cluster.x-k8s.io/node-group': 'agent' }
    : process.env.AGENT_NODE_SELECTOR === ''
      ? undefined
      : Object.fromEntries(process.env.AGENT_NODE_SELECTOR.split(',').map((p) => p.split('=')))

const AFS_ENABLED = process.env.AFS_ENABLED === 'true'
const AFS_IMAGE = process.env.AFS_IMAGE || ''
if (AFS_ENABLED && !AFS_IMAGE) {
  throw new Error('AFS_ENABLED=true but AFS_IMAGE is not set')
}
const AFS_CONTROLLER_ADDR = process.env.AFS_CONTROLLER_ADDR || 'afs-controller.default.svc:9100'
const AFS_FUSE_SERVER_ADDR = process.env.AFS_FUSE_SERVER_ADDR || '127.0.0.1:9101'
const AFS_STORAGE_PVC = process.env.AFS_STORAGE_PVC || 'afs-shared-storage'
const AFS_CONFIGMAP = process.env.AFS_CONFIGMAP || 'afs-fuse-config'

const MEMORY_FUSE_IMAGE = process.env.MEMORY_FUSE_IMAGE || ''

export function isMemoryFuseAvailable(): boolean {
  return MEMORY_FUSE_IMAGE !== ''
}

export function getAgentImage(agentType: string): string {
  return `${AGENT_IMAGE_PREFIX}-${agentType}:${AGENT_IMAGE_TAG}`
}
const WORKSPACE_STORAGE_SIZE = process.env.WORKSPACE_STORAGE_SIZE || '10Gi'
const NAME_PREFIX = 'tos'

// Whether this environment may host auto-scaling (multi-replica) workspaces.
// Gated on the storage class supporting ReadWriteMany (all replicas share one
// RWX workspace PVC), which is a deploy-time property, so it is an explicit
// opt-in env rather than inferred. Default off → the environment advertises no
// multiReplica capability and placement rejects auto-scaling there.
const WORKSPACE_MULTI_REPLICA = process.env.WORKSPACE_MULTI_REPLICA === 'true'

/**
 * All infra config a `buildDeploymentSpec` / provider instance needs,
 * captured explicitly instead of read from module-level env at call time. This
 * is the seam that lets the built-in environment and (later) a remote runner
 * share the same provider code with different config. {@link defaultK8sConfig}
 * reproduces today's env-derived values verbatim, so behavior is unchanged.
 */
export interface K8sConfig {
  namespace: string
  namePrefix: string
  agentImagePrefix: string
  agentImageTag: string
  storageClass: string
  imagePullSecret: string
  nodeSelector?: Record<string, string>
  workspaceStorageSize: string
  cpServiceUrl: string
  memoryFuseImage: string
  /** This environment may host auto-scaling workspaces (RWX storage available). */
  multiReplica: boolean
  afs: {
    enabled: boolean
    image: string
    controllerAddr: string
    fuseServerAddr: string
    storagePvc: string
    configMap: string
  }
}

/** The platform's built-in environment config, derived from process.env. */
function defaultK8sConfig(): K8sConfig {
  return {
    namespace: NAMESPACE,
    namePrefix: NAME_PREFIX,
    agentImagePrefix: AGENT_IMAGE_PREFIX,
    agentImageTag: AGENT_IMAGE_TAG,
    storageClass: AGENT_STORAGE_CLASS,
    imagePullSecret: IMAGE_PULL_SECRET,
    nodeSelector: AGENT_NODE_SELECTOR,
    workspaceStorageSize: WORKSPACE_STORAGE_SIZE,
    cpServiceUrl: process.env.CP_SERVICE_URL || 'http://nap-cp:3000',
    memoryFuseImage: MEMORY_FUSE_IMAGE,
    multiReplica: WORKSPACE_MULTI_REPLICA,
    afs: {
      enabled: AFS_ENABLED,
      image: AFS_IMAGE,
      controllerAddr: AFS_CONTROLLER_ADDR,
      fuseServerAddr: AFS_FUSE_SERVER_ADDR,
      storagePvc: AFS_STORAGE_PVC,
      configMap: AFS_CONFIGMAP,
    },
  }
}

/** Singleton config for the built-in environment (today's only environment). */
export const defaultCfg = defaultK8sConfig()

/** Agent image resolution from explicit config (cf. {@link getAgentImage}). */
export function agentImageFor(cfg: K8sConfig, agentType: string): string {
  return `${cfg.agentImagePrefix}-${agentType}:${cfg.agentImageTag}`
}
