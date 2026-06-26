import * as k8s from '@kubernetes/client-node'
import type { ComputeResources } from '../types/api'
import type {
  Capabilities,
  EnvironmentProvider,
  ObservedState,
  WorkspaceSpec,
} from '../types/environments'

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

// Workspace pod spec template version. Bump when buildDeploymentSpec produces
// a structurally different pod for reasons unrelated to per-ws config (e.g.
// platform sidecar added/removed, mount layout changed). Per-ws config like
// memory attachments does NOT bump this — that goes through on-change rebuild.
// Written to the Deployment annotation so future drift checks can decide
// whether to rebuild a stale ws.
// v1: agent + afs-fuse sidecar
// v2: + memory-fuse sidecar scaffold (gated per-ws by attachment presence)
// v3: memory-fuse gains a /var/cache/memory-fuse emptyDir for disk-backed
//     content cache. Without v3 the daemon falls back to in-memory only, so
//     existing v2 pods stay correct — but reconcile will rebuild them on
//     their next start/attach so the cache speedup actually applies.
// v4: sidecar is unconditional on this cluster (gated only by
//     MEMORY_FUSE_IMAGE). The attachment-driven gating we had at v2/v3 is
//     retired now that every ws has a default store attached. Side effect:
//     reconcile no longer fires from attach/detach (count is always >= 1).
// v5: afs-fuse sidecar gains AFS_BOOTSTRAP_URL env so it can self-heal
//     mounts on pod replacement without relying on cp's push path.
// v6: agent probes relaxed — added a startupProbe (up to 600s boot grace)
//     and widened liveness/readiness timeouts so skill-heavy boots and
//     event-loop saturation no longer trip a SIGKILL. The probe spec
//     changed in buildDeploymentSpec without a version bump, so existing
//     v5 Deployments kept the old 1s-timeout / no-startupProbe config and
//     CrashLoopBackOff'd; bumping forces reconcile to rebuild them.
export const CURRENT_TEMPLATE_VERSION = 6
const TEMPLATE_VERSION_ANNOTATION = 'agent-platform/workspace-version'
const MEMORY_FUSE_CONTAINER_NAME = 'memory-fuse'

/**
 * All infra config a {@link buildDeploymentSpec} / provider instance needs,
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
const defaultCfg = defaultK8sConfig()

/** Agent image resolution from explicit config (cf. {@link getAgentImage}). */
function agentImageFor(cfg: K8sConfig, agentType: string): string {
  return `${cfg.agentImagePrefix}-${agentType}:${cfg.agentImageTag}`
}

interface K8sInstance {
  workspaceId: string
  status: 'pending' | 'running' | 'failed'
  createdAt: string
}

interface K8sResourceStatus {
  deployment: {
    exists: boolean
    ready: boolean
    replicas: number
    readyReplicas: number
  }
  service: { exists: boolean }
  pvc: { exists: boolean; phase?: string; capacity?: string }
  pods: { total: number; ready: number }
  warnings: Array<{ reason: string; message: string }>
  conditions: Array<{ type: string; status: boolean; message?: string }>
}

export function buildDeploymentSpec(
  name: string,
  labels: Record<string, string>,
  workspaceId: string,
  agentType: string,
  pvcName: string,
  resources?: ComputeResources,
  cfg: K8sConfig = defaultCfg,
): k8s.V1Deployment {
  // memory-fuse sidecar is unconditional on any cluster that ships the
  // image. The historical per-ws attachment gating was retired in template
  // v4 once every ws got a default store; keeping it would just be a no-op
  // (count is always >= 1).
  const memoryFuseActive = cfg.memoryFuseImage !== ''

  const agentContainer: k8s.V1Container = {
    name: 'agent',
    image: agentImageFor(cfg, agentType),
    ports: [{ containerPort: 3001, name: 'http' }],
    env: [
      { name: 'WORKSPACE_DIR', value: '/workspace' },
      { name: 'CP_URL', value: cfg.cpServiceUrl },
      { name: 'WORKSPACE_ID', value: workspaceId },
      ...(cfg.afs.enabled
        ? [
            { name: 'AFS_CONTROLLER', value: cfg.afs.controllerAddr },
            { name: 'AFS_FUSE_SERVER', value: cfg.afs.fuseServerAddr },
          ]
        : []),
    ],
    volumeMounts: [
      { name: 'workspace', mountPath: '/workspace' },
      ...(cfg.afs.enabled
        ? [{ name: 'afs-mnt', mountPath: '/mnt/afs', mountPropagation: 'HostToContainer' }]
        : []),
      ...(memoryFuseActive
        ? [{ name: 'memory-mnt', mountPath: '/mnt/memory', mountPropagation: 'HostToContainer' }]
        : []),
    ],
    resources: {
      requests: {
        memory: resources?.memory_request || '256Mi',
        cpu: resources?.cpu_request || '100m',
      },
      limits: {
        memory: resources?.memory_limit || '1Gi',
        cpu: resources?.cpu_limit || '500m',
      },
    },
    // Skills are downloaded/unzipped/symlinked synchronously during boot,
    // before the agent binds :3001 — a skill-heavy workspace (e.g. 29 skills
    // ~2m30s) can take minutes to become reachable. Without a startupProbe the
    // liveness probe starts ticking from initialDelay and SIGKILLs the process
    // mid-boot; the restart wipes /tmp (tmpfs) and re-extracts from zero, so it
    // never finishes → CrashLoopBackOff. The startupProbe holds liveness off
    // until /health first answers, giving boot up to 600s (120 × 5s) of grace.
    startupProbe: {
      httpGet: { path: '/health', port: 3001 as any },
      initialDelaySeconds: 5,
      periodSeconds: 5,
      timeoutSeconds: 3,
      failureThreshold: 120,
    },
    livenessProbe: {
      httpGet: { path: '/health', port: 3001 as any },
      initialDelaySeconds: 5,
      periodSeconds: 30,
      // The agent serves /health on the same single Node event loop that
      // fans out ACP bridge events. Under heavy concurrent sessions (e.g.
      // multi-agent PPT orchestration) a burst of tool-call/message events
      // can starve the loop so a short health GET can't be scheduled in
      // time — the process is busy, not dead. Give generous headroom before
      // a liveness kill so transient saturation doesn't restart the pod.
      timeoutSeconds: 5,
      failureThreshold: 6,
    },
    readinessProbe: {
      httpGet: { path: '/health', port: 3001 as any },
      initialDelaySeconds: 3,
      periodSeconds: 10,
      timeoutSeconds: 3,
      failureThreshold: 3,
    },
  }

  const afsSidecar: k8s.V1Container | undefined = cfg.afs.enabled
    ? {
        name: 'afs-fuse',
        image: cfg.afs.image,
        command: ['afs-fuse'],
        args: ['/etc/afs/fuse-server.toml'],
        env: [
          // Boot-pull endpoint: on sidecar startup the daemon GETs this and
          // re-issues local Mount RPCs for each share. Covers pod-replacement
          // scenarios where cp's deployment-level watch never sees a status
          // transition (cp restart mid-replace, scale events). Mount itself
          // is idempotent (ALREADY_EXISTS swallowed daemon-side).
          {
            name: 'AFS_BOOTSTRAP_URL',
            value: `${cfg.cpServiceUrl}/_cp/workspaces/${workspaceId}/afs-mounts`,
          },
        ],
        securityContext: { privileged: true },
        volumeMounts: [
          { name: 'afs-mnt', mountPath: '/mnt/afs', mountPropagation: 'Bidirectional' },
          { name: 'afs-storage', mountPath: '/data/afs' },
          { name: 'afs-fuse-config', mountPath: '/etc/afs' },
          { name: 'dev-fuse', mountPath: '/dev/fuse' },
        ],
      }
    : undefined

  const memoryFuseSidecar: k8s.V1Container | undefined = memoryFuseActive
    ? {
        name: MEMORY_FUSE_CONTAINER_NAME,
        image: cfg.memoryFuseImage,
        env: [
          { name: 'CP_URL', value: cfg.cpServiceUrl },
          { name: 'WORKSPACE_ID', value: workspaceId },
          // gRPC mount/unmount RPC: bind 0.0.0.0:9102 so cp can dial via the ws
          // Service (same pattern as afs-fuse on :9101). Trust cluster network.
          { name: 'GRPC_LISTEN_ADDR', value: '0.0.0.0:9102' },
        ],
        ports: [{ containerPort: 9102, name: 'memory-fuse' }],
        // Bidirectional mount propagation requires a privileged container —
        // same constraint that afs-fuse runs under. SYS_ADMIN alone isn't
        // enough; the kernel check is on cap_sys_admin + privileged flag.
        securityContext: { privileged: true },
        volumeMounts: [
          { name: 'memory-mnt', mountPath: '/mnt/memory', mountPropagation: 'Bidirectional' },
          // Disk-backed content cache: survives in-container daemon restarts
          // (emptyDir lives with the pod). Pod reschedule clears it; the
          // daemon's boot pull + lazy fetch refills on demand.
          { name: 'memory-cache', mountPath: '/var/cache/memory-fuse' },
          { name: 'dev-fuse', mountPath: '/dev/fuse' },
        ],
      }
    : undefined

  // dev-fuse hostPath is shared by afs-fuse and memory-fuse; declare once if either enabled
  const needsDevFuse = cfg.afs.enabled || memoryFuseActive

  const volumes: k8s.V1Volume[] = [
    { name: 'workspace', persistentVolumeClaim: { claimName: pvcName } },
    ...(cfg.afs.enabled
      ? [
          { name: 'afs-mnt', emptyDir: {} },
          { name: 'afs-storage', persistentVolumeClaim: { claimName: cfg.afs.storagePvc } },
          { name: 'afs-fuse-config', configMap: { name: cfg.afs.configMap } },
        ]
      : []),
    ...(memoryFuseActive
      ? [
          { name: 'memory-mnt', emptyDir: {} },
          { name: 'memory-cache', emptyDir: {} },
        ]
      : []),
    ...(needsDevFuse ? [{ name: 'dev-fuse', hostPath: { path: '/dev/fuse' } }] : []),
  ]

  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: {
      name,
      labels,
      annotations: { [TEMPLATE_VERSION_ANNOTATION]: String(CURRENT_TEMPLATE_VERSION) },
    },
    spec: {
      replicas: 1,
      selector: { matchLabels: labels },
      // Single-replica workspace pods already have a mini-downtime during any
      // restart (agent container is slow to SIGTERM), so Rolling gains no
      // real zero-downtime — and Rolling's double-pod peak frequently
      // fails to schedule on a memory-constrained cluster. Recreate kills
      // the old pod first, freeing its memory request before the new one
      // is placed.
      strategy: { type: 'Recreate' },
      template: {
        metadata: { labels },
        spec: {
          // Agent container runs as `node` (UID/GID 1000 in node:20-slim).
          // nfs-csi mounts are typically world-writable so the missing
          // fsGroup wasn't visible — but block-mode CSIs (ELF, RBD, vSphere
          // CSI, etc.) hand us a fresh ext4 owned root:root / 0755 and the
          // agent then EACCESes on mkdir /workspace/.home/.codex. fsGroup
          // makes kubelet chgrp the mount to 1000 + add group-write; the
          // OnRootMismatch policy avoids re-chown'ing every restart once
          // the workspace has grown large.
          securityContext: {
            fsGroup: 1000,
            fsGroupChangePolicy: 'OnRootMismatch',
          },
          nodeSelector: cfg.nodeSelector,
          ...(cfg.imagePullSecret ? { imagePullSecrets: [{ name: cfg.imagePullSecret }] } : {}),
          containers: [agentContainer, afsSidecar, memoryFuseSidecar].filter(
            (c): c is k8s.V1Container => !!c,
          ),
          volumes,
        },
      },
    },
  }
}

interface InstanceSpecMarkers {
  templateVersion: number | null
  agentImage: string | null
  hasMemoryFuseSidecar: boolean
}

/**
 * Batch-check K8s deployment statuses for active workspaces.
 * Returns a map of workspaceId → resolved status.
 * Uses a single listNamespacedDeployment call (O(1) K8s API).
 */
export type ReconciledStatus = 'running' | 'stopped' | 'starting' | 'error'

/** Resolve a single deployment to a workspace status. */
export function resolveDeploymentStatus(dep: k8s.V1Deployment | undefined): ReconciledStatus {
  if (!dep || (dep.spec?.replicas ?? 0) === 0) return 'stopped'

  const replicas = dep.spec?.replicas ?? 0
  const readyReplicas = dep.status?.readyReplicas ?? 0

  if (readyReplicas >= replicas) return 'running'

  const progressing = dep.status?.conditions?.find((c) => c.type === 'Progressing')
  if (progressing?.status === 'True') return 'starting'

  return 'error'
}

/**
 * Read the template version stamped on a Deployment (the workspace-version
 * annotation), or null if absent/unparseable. The reconcile loop caches this
 * onto the workspace row so drift checks don't need a live k8s read.
 */
export function deploymentTemplateVersion(dep: k8s.V1Deployment | undefined): number | null {
  const raw = dep?.metadata?.annotations?.[TEMPLATE_VERSION_ANNOTATION]
  if (raw === undefined) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

/**
 * Kubernetes provisioning backend. Holds its own API clients + config so a
 * remote runner can construct one with injected credentials/config; the
 * built-in environment uses {@link defaultProvider}, which loads from env.
 * Lifecycle methods are the same logic that used to live in the module-level
 * functions — the exported functions below are thin wrappers over
 * {@link defaultProvider} so existing call sites stay unchanged.
 */
export class KubernetesProvider implements EnvironmentProvider {
  constructor(
    private readonly appsApi: k8s.AppsV1Api,
    private readonly coreApi: k8s.CoreV1Api,
    private readonly kc: k8s.KubeConfig,
    private readonly cfg: K8sConfig,
  ) {}

  private getResourceName(workspaceId: string): string {
    return `${this.cfg.namePrefix}-${workspaceId}`
  }

  private getLabels(workspaceId: string): Record<string, string> {
    return {
      app: this.cfg.namePrefix,
      component: 'workspace',
      'workspace-id': workspaceId,
    }
  }

  /** Create K8s resources for a workspace */
  async createInstance(
    workspaceId: string,
    agentType = 'claude-code',
    resources?: ComputeResources,
  ): Promise<K8sInstance> {
    const name = this.getResourceName(workspaceId)
    const labels = this.getLabels(workspaceId)
    const pvcName = `${name}-workspace`

    // Create PVC for workspace persistent storage
    const storageSize = resources?.storage || this.cfg.workspaceStorageSize
    await this.coreApi.createNamespacedPersistentVolumeClaim(this.cfg.namespace, {
      apiVersion: 'v1',
      kind: 'PersistentVolumeClaim',
      metadata: { name: pvcName, labels },
      spec: {
        accessModes: ['ReadWriteOnce'],
        storageClassName: this.cfg.storageClass,
        resources: { requests: { storage: storageSize } },
      },
    })

    // Create Deployment
    await this.appsApi.createNamespacedDeployment(
      this.cfg.namespace,
      buildDeploymentSpec(name, labels, workspaceId, agentType, pvcName, resources, this.cfg),
    )

    // Create Service (ClusterIP — agents are reached via cluster DNS at
    // tos-<wsId>.<ns>.svc:3001; afs-fuse via :9101)
    await this.coreApi.createNamespacedService(this.cfg.namespace, {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: { name, labels },
      spec: {
        selector: labels,
        ports: [
          { port: 3001, targetPort: 3001 as any, name: 'http' },
          { port: 9101, targetPort: 9101 as any, name: 'afs-fuse' },
          { port: 9102, targetPort: 9102 as any, name: 'memory-fuse' },
        ],
        type: 'ClusterIP',
      },
    })

    return {
      workspaceId,
      status: 'pending',
      createdAt: new Date().toISOString(),
    }
  }

  /** Get K8s instance by workspace ID */
  async getInstance(workspaceId: string): Promise<K8sInstance | null> {
    const name = this.getResourceName(workspaceId)

    try {
      const deploymentRes = await this.appsApi.readNamespacedDeployment(name, this.cfg.namespace)
      const deployment = deploymentRes.body
      const readyReplicas = deployment.status?.readyReplicas || 0

      return {
        workspaceId,
        status: readyReplicas > 0 ? 'running' : 'pending',
        createdAt: deployment.metadata?.creationTimestamp?.toISOString() || '',
      }
    } catch (e: any) {
      if (e.response?.statusCode === 404) {
        return null
      }
      throw e
    }
  }

  /** List all K8s instances */
  async listInstances(): Promise<K8sInstance[]> {
    const response = await this.appsApi.listNamespacedDeployment(
      this.cfg.namespace,
      undefined, // pretty
      undefined, // allowWatchBookmarks
      undefined, // _continue
      undefined, // fieldSelector
      `app=${this.cfg.namePrefix}`, // labelSelector
    )

    const instances: K8sInstance[] = []

    for (const dep of response.body.items) {
      const workspaceId = dep.metadata?.labels?.['workspace-id']
      if (!workspaceId) continue

      const readyReplicas = dep.status?.readyReplicas || 0
      instances.push({
        workspaceId,
        status: readyReplicas > 0 ? 'running' : 'pending',
        createdAt: dep.metadata?.creationTimestamp?.toISOString() || '',
      })
    }

    return instances
  }

  /** Scale K8s deployment (0 = stopped, 1 = running) */
  private async scaleInstance(workspaceId: string, replicas: number): Promise<boolean> {
    const name = this.getResourceName(workspaceId)

    try {
      await this.appsApi.patchNamespacedDeploymentScale(
        name,
        this.cfg.namespace,
        { spec: { replicas } },
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { headers: { 'Content-Type': 'application/merge-patch+json' } },
      )
      return true
    } catch (e: any) {
      if (e.response?.statusCode === 404) {
        return false
      }
      throw e
    }
  }

  /** Stop instance (scale to 0) */
  async stopInstance(workspaceId: string): Promise<boolean> {
    return this.scaleInstance(workspaceId, 0)
  }

  /** Start/resume instance (scale to 1) */
  async startInstance(workspaceId: string): Promise<boolean> {
    return this.scaleInstance(workspaceId, 1)
  }

  /**
   * Roll the instance's pods without changing the Deployment spec — the
   * equivalent of `kubectl rollout restart`. Stamps a template annotation so
   * the Deployment controller recreates the pod (e.g. to re-pull a moving
   * `:latest` tag). Returns false when the Deployment doesn't exist.
   */
  async restartInstance(workspaceId: string): Promise<boolean> {
    const name = this.getResourceName(workspaceId)
    try {
      await this.appsApi.patchNamespacedDeployment(
        name,
        this.cfg.namespace,
        {
          spec: {
            template: {
              metadata: {
                annotations: {
                  'kubectl.kubernetes.io/restartedAt': new Date().toISOString(),
                },
              },
            },
          },
        },
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { headers: { 'Content-Type': 'application/strategic-merge-patch+json' } },
      )
      return true
    } catch (e: any) {
      if (e.response?.statusCode === 404) return false
      throw e
    }
  }

  /**
   * Read the markers needed to decide whether a Deployment is in sync with the
   * desired spec: template_version (from annotation), agent image (from the
   * `agent` container), and memory-fuse sidecar presence (from container list).
   * Returns null when no Deployment exists for the workspace.
   */
  async getInstanceSpecMarkers(workspaceId: string): Promise<InstanceSpecMarkers | null> {
    const name = this.getResourceName(workspaceId)
    try {
      const res = await this.appsApi.readNamespacedDeployment(name, this.cfg.namespace)
      const dep = res.body
      const containers = dep.spec?.template?.spec?.containers ?? []
      const agent = containers.find((c) => c.name === 'agent')
      const ver = dep.metadata?.annotations?.[TEMPLATE_VERSION_ANNOTATION]
      return {
        templateVersion: ver ? Number(ver) : null,
        agentImage: agent?.image ?? null,
        hasMemoryFuseSidecar: containers.some((c) => c.name === MEMORY_FUSE_CONTAINER_NAME),
      }
    } catch (e: any) {
      if (e.response?.statusCode === 404) return null
      throw e
    }
  }

  /**
   * Rebuild a workspace deployment with a new agent type.
   * Deletes only the Deployment and recreates it, preserving PVC and Service.
   */
  async rebuildInstance(
    workspaceId: string,
    agentType: string,
    resources?: ComputeResources,
  ): Promise<void> {
    const name = this.getResourceName(workspaceId)
    const labels = this.getLabels(workspaceId)
    const pvcName = `${name}-workspace`

    // Delete existing deployment
    try {
      await this.appsApi.deleteNamespacedDeployment(name, this.cfg.namespace)
    } catch (e: any) {
      if (e.response?.statusCode !== 404) throw e
    }

    // Recreate deployment with new agent type
    await this.appsApi.createNamespacedDeployment(
      this.cfg.namespace,
      buildDeploymentSpec(name, labels, workspaceId, agentType, pvcName, resources, this.cfg),
    )
  }

  /** Update Deployment CPU/memory resources (triggers rolling restart) */
  async updateInstanceResources(
    workspaceId: string,
    resources: ComputeResources,
  ): Promise<boolean> {
    const name = this.getResourceName(workspaceId)

    try {
      await this.appsApi.patchNamespacedDeployment(
        name,
        this.cfg.namespace,
        {
          spec: {
            template: {
              spec: {
                containers: [
                  {
                    name: 'agent',
                    resources: {
                      requests: {
                        cpu: resources.cpu_request || '100m',
                        memory: resources.memory_request || '256Mi',
                      },
                      limits: {
                        cpu: resources.cpu_limit || '500m',
                        memory: resources.memory_limit || '1Gi',
                      },
                    },
                  },
                ],
              },
            },
          },
        },
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { headers: { 'Content-Type': 'application/strategic-merge-patch+json' } },
      )
      return true
    } catch (e: any) {
      if (e.response?.statusCode === 404) return false
      throw e
    }
  }

  /** Expand PVC storage (only increases, requires StorageClass support) */
  async expandInstanceStorage(workspaceId: string, newSize: string): Promise<boolean> {
    const name = this.getResourceName(workspaceId)
    const pvcName = `${name}-workspace`

    try {
      await this.coreApi.patchNamespacedPersistentVolumeClaim(
        pvcName,
        this.cfg.namespace,
        { spec: { resources: { requests: { storage: newSize } } } },
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { headers: { 'Content-Type': 'application/merge-patch+json' } },
      )
      return true
    } catch (e: any) {
      if (e.response?.statusCode === 404) return false
      throw e
    }
  }

  /** Get detailed K8s resource status for a workspace */
  async getInstanceStatus(workspaceId: string): Promise<K8sResourceStatus> {
    const name = this.getResourceName(workspaceId)
    const labelSelector = `app=${this.cfg.namePrefix},workspace-id=${workspaceId}`

    const result: K8sResourceStatus = {
      deployment: { exists: false, ready: false, replicas: 0, readyReplicas: 0 },
      service: { exists: false },
      pvc: { exists: false },
      pods: { total: 0, ready: 0 },
      warnings: [],
      conditions: [],
    }

    const pvcName = `${name}-workspace`

    // Query all resources concurrently
    const [depResult, svcResult, pvcResult, podsResult] = await Promise.allSettled([
      this.appsApi.readNamespacedDeployment(name, this.cfg.namespace),
      this.coreApi.readNamespacedService(name, this.cfg.namespace),
      this.coreApi.readNamespacedPersistentVolumeClaim(pvcName, this.cfg.namespace),
      this.coreApi.listNamespacedPod(
        this.cfg.namespace,
        undefined,
        undefined,
        undefined,
        undefined,
        labelSelector,
      ),
    ])

    // Process Deployment
    if (depResult.status === 'fulfilled') {
      const dep = depResult.value.body
      const replicas = dep.spec?.replicas || 0
      const readyReplicas = dep.status?.readyReplicas || 0

      result.deployment = {
        exists: true,
        ready: readyReplicas >= replicas && replicas > 0,
        replicas,
        readyReplicas,
      }

      // Extract conditions. Skip Available=False with reason MinimumReplicasUnavailable —
      // this is the transient state during a rolling update (e.g. resize) where old pods
      // are terminating and new pods are not yet ready. Surfacing it as a failure makes
      // the Settings page flash red during routine scale-up/down.
      if (dep.status?.conditions) {
        for (const c of dep.status.conditions) {
          if (c.type === 'Available' || c.type === 'Progressing') {
            if (
              c.type === 'Available' &&
              c.status !== 'True' &&
              c.reason === 'MinimumReplicasUnavailable'
            ) {
              continue
            }
            result.conditions.push({
              type: c.type,
              status: c.status === 'True',
              message: c.message,
            })
          }
        }
      }
    } else if ((depResult.reason as any)?.response?.statusCode !== 404) {
      result.conditions.push({
        type: 'DeploymentError',
        status: false,
        message: depResult.reason?.message,
      })
    }

    // Process Service
    if (svcResult.status === 'fulfilled') {
      result.service = { exists: true }
    } else if ((svcResult.reason as any)?.response?.statusCode !== 404) {
      result.conditions.push({
        type: 'ServiceError',
        status: false,
        message: svcResult.reason?.message,
      })
    }

    // Process PVC
    if (pvcResult.status === 'fulfilled') {
      const pvc = pvcResult.value.body
      result.pvc = {
        exists: true,
        phase: pvc.status?.phase,
        capacity: pvc.status?.capacity?.storage,
      }
    } else if ((pvcResult.reason as any)?.response?.statusCode !== 404) {
      result.conditions.push({
        type: 'PVCError',
        status: false,
        message: pvcResult.reason?.message,
      })
    }

    // Process Pods and fetch events
    if (podsResult.status === 'fulfilled') {
      const pods = podsResult.value.body.items
      const podNames: string[] = []

      for (const pod of pods) {
        const podName = pod.metadata?.name || ''
        podNames.push(podName)

        const containerStatuses = pod.status?.containerStatuses || []
        const allReady = containerStatuses.length > 0 && containerStatuses.every((c) => c.ready)

        result.pods.total++
        if (allReady) result.pods.ready++
      }

      // Fetch events for all pods concurrently
      if (podNames.length > 0) {
        const eventResults = await Promise.allSettled(
          podNames.map((podName) =>
            this.coreApi.listNamespacedEvent(
              this.cfg.namespace,
              undefined,
              undefined,
              undefined,
              `involvedObject.name=${podName},involvedObject.kind=Pod`,
            ),
          ),
        )

        // Deduplicate warnings by reason+message
        const seen = new Set<string>()
        for (const eventResult of eventResults) {
          if (eventResult.status === 'fulfilled') {
            for (const event of eventResult.value.body.items) {
              if (event.type !== 'Warning') continue
              const key = `${event.reason}:${event.message}`
              if (seen.has(key)) continue
              seen.add(key)
              result.warnings.push({
                reason: event.reason || '',
                message: event.message || '',
              })
            }
          }
        }
        // Limit to 5 warnings
        result.warnings = result.warnings.slice(0, 5)
      }
    }

    return result
  }

  /**
   * Full list of all workspace deployments. Returns deployments indexed by
   * workspace-id plus the response resourceVersion for starting a watch.
   */
  async listWorkspaceDeployments(timeoutMs = 30_000): Promise<{
    deployments: Map<string, k8s.V1Deployment>
    resourceVersion: string
  }> {
    const response = await Promise.race([
      this.appsApi.listNamespacedDeployment(
        this.cfg.namespace,
        undefined,
        undefined,
        undefined,
        undefined,
        `app=${this.cfg.namePrefix},component=workspace`,
      ),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`listWorkspaceDeployments timed out after ${timeoutMs}ms`)),
          timeoutMs,
        ),
      ),
    ])

    const deployments = new Map<string, k8s.V1Deployment>()
    for (const dep of response.body.items) {
      const wsId = dep.metadata?.labels?.['workspace-id']
      if (wsId) deployments.set(wsId, dep)
    }

    const resourceVersion = response.body.metadata?.resourceVersion ?? ''
    return { deployments, resourceVersion }
  }

  /**
   * Watch workspace deployments for changes starting from a resourceVersion.
   * Calls `onUpdate(workspaceId, status)` for each change.
   * Returns an abort function to stop the watch.
   */
  watchDeployments(
    resourceVersion: string,
    onUpdate: (workspaceId: string, status: ReconciledStatus) => void,
    onError: (err: unknown) => void,
  ): () => void {
    const watch = new k8s.Watch(this.kc)
    let aborted = false

    const path = `/apis/apps/v1/namespaces/${this.cfg.namespace}/deployments`
    const params = {
      labelSelector: `app=${this.cfg.namePrefix},component=workspace`,
      resourceVersion,
    }

    const req: ReturnType<typeof watch.watch> = watch.watch(
      path,
      params,
      (type, dep: k8s.V1Deployment) => {
        const wsId = dep.metadata?.labels?.['workspace-id']
        if (!wsId) return
        const status = type === 'DELETED' ? ('stopped' as const) : resolveDeploymentStatus(dep)
        onUpdate(wsId, status)
      },
      (err) => {
        if (!aborted) onError(err)
      },
    )

    return () => {
      aborted = true
      req?.then((r) => r.destroy()).catch(() => {})
    }
  }

  /** Delete K8s resources for a workspace */
  async deleteInstance(workspaceId: string): Promise<boolean> {
    const name = this.getResourceName(workspaceId)

    try {
      await Promise.all([
        this.appsApi.deleteNamespacedDeployment(name, this.cfg.namespace),
        this.coreApi.deleteNamespacedService(name, this.cfg.namespace),
        this.coreApi.deleteNamespacedPersistentVolumeClaim(`${name}-workspace`, this.cfg.namespace),
      ])
      return true
    } catch (e: any) {
      if (e.response?.statusCode === 404) {
        return false
      }
      throw e
    }
  }

  // ── EnvironmentProvider interface ──
  // Infra-agnostic facade over the methods above, consumed by the runner. The
  // legacy methods stay (their callers are unchanged); these adapt signatures
  // to WorkspaceSpec / ObservedState. Lifecycle methods discard the legacy
  // boolean return (false = "no such Deployment", which is a no-op for an
  // idempotent converge).

  /** Create if absent, else rebuild to converge (v1: cp bumps version → rebuild). */
  async apply(workspaceId: string, spec: WorkspaceSpec): Promise<void> {
    const existing = await this.getInstance(workspaceId)
    if (existing) {
      await this.rebuildInstance(workspaceId, spec.agentType, spec.resources)
    } else {
      await this.createInstance(workspaceId, spec.agentType, spec.resources)
    }
  }

  async start(workspaceId: string): Promise<void> {
    await this.startInstance(workspaceId)
  }

  async stop(workspaceId: string): Promise<void> {
    await this.stopInstance(workspaceId)
  }

  async destroy(workspaceId: string): Promise<void> {
    await this.deleteInstance(workspaceId)
  }

  async resize(workspaceId: string, resources: ComputeResources): Promise<void> {
    await this.updateInstanceResources(workspaceId, resources)
  }

  async expandStorage(workspaceId: string, sizeGi: number): Promise<void> {
    await this.expandInstanceStorage(workspaceId, `${sizeGi}Gi`)
  }

  /**
   * Point-in-time observation via a single Deployment read. `version` is left
   * undefined: the spec-convergence version is a placement concept the runner
   * tracks itself (NOT the pod-template version stamped on the Deployment).
   */
  async observe(workspaceId: string): Promise<ObservedState> {
    const name = this.getResourceName(workspaceId)
    try {
      const res = await this.appsApi.readNamespacedDeployment(name, this.cfg.namespace)
      return {
        phase: resolveDeploymentStatus(res.body),
        endpoint: {
          address: `${name}.${this.cfg.namespace}.svc.cluster.local:3001`,
        },
      }
    } catch (e: any) {
      if (e.response?.statusCode === 404) {
        return { phase: 'unknown' }
      }
      throw e
    }
  }

  capabilities(): Capabilities {
    return {
      sharedFs: this.cfg.afs.enabled,
      persistentMemory: this.cfg.memoryFuseImage !== '',
      gpu: false,
    }
  }
}

/** Build the built-in environment's provider from process.env (loads kubeconfig). */
export function makeDefaultProvider(): KubernetesProvider {
  const kc = new k8s.KubeConfig()
  if (process.env.KUBECONFIG) {
    kc.loadFromFile(process.env.KUBECONFIG)
  } else if (process.env.KUBERNETES_SERVICE_HOST) {
    kc.loadFromCluster()
  } else {
    kc.loadFromDefault()
  }
  return new KubernetesProvider(
    kc.makeApiClient(k8s.AppsV1Api),
    kc.makeApiClient(k8s.CoreV1Api),
    kc,
    defaultCfg,
  )
}
