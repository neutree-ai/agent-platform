import * as k8s from '@kubernetes/client-node'
import type { ComputeResources } from '../../../internal/types/api'

// Load kubeconfig
const kc = new k8s.KubeConfig()
if (process.env.KUBECONFIG) {
  kc.loadFromFile(process.env.KUBECONFIG)
} else if (process.env.KUBERNETES_SERVICE_HOST) {
  kc.loadFromCluster()
} else {
  kc.loadFromDefault()
}

const k8sAppsApi = kc.makeApiClient(k8s.AppsV1Api)
const k8sCoreApi = kc.makeApiClient(k8s.CoreV1Api)

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

function getResourceName(workspaceId: string): string {
  return `${NAME_PREFIX}-${workspaceId}`
}

function getLabels(workspaceId: string): Record<string, string> {
  return {
    app: NAME_PREFIX,
    component: 'workspace',
    'workspace-id': workspaceId,
  }
}

function buildDeploymentSpec(
  name: string,
  labels: Record<string, string>,
  workspaceId: string,
  agentType: string,
  pvcName: string,
  resources?: ComputeResources,
): k8s.V1Deployment {
  // memory-fuse sidecar is unconditional on any cluster that ships the
  // image. The historical per-ws attachment gating was retired in template
  // v4 once every ws got a default store; keeping it would just be a no-op
  // (count is always >= 1).
  const memoryFuseActive = MEMORY_FUSE_IMAGE !== ''

  const agentContainer: k8s.V1Container = {
    name: 'agent',
    image: getAgentImage(agentType),
    ports: [{ containerPort: 3001, name: 'http' }],
    env: [
      { name: 'WORKSPACE_DIR', value: '/workspace' },
      { name: 'CP_URL', value: process.env.CP_SERVICE_URL || 'http://nap-cp:3000' },
      { name: 'WORKSPACE_ID', value: workspaceId },
      ...(AFS_ENABLED
        ? [
            { name: 'AFS_CONTROLLER', value: AFS_CONTROLLER_ADDR },
            { name: 'AFS_FUSE_SERVER', value: AFS_FUSE_SERVER_ADDR },
          ]
        : []),
    ],
    volumeMounts: [
      { name: 'workspace', mountPath: '/workspace' },
      ...(AFS_ENABLED
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

  const afsSidecar: k8s.V1Container | undefined = AFS_ENABLED
    ? {
        name: 'afs-fuse',
        image: AFS_IMAGE,
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
            value: `${process.env.CP_SERVICE_URL || 'http://nap-cp:3000'}/_cp/workspaces/${workspaceId}/afs-mounts`,
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
        image: MEMORY_FUSE_IMAGE,
        env: [
          { name: 'CP_URL', value: process.env.CP_SERVICE_URL || 'http://nap-cp:3000' },
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
  const needsDevFuse = AFS_ENABLED || memoryFuseActive

  const volumes: k8s.V1Volume[] = [
    { name: 'workspace', persistentVolumeClaim: { claimName: pvcName } },
    ...(AFS_ENABLED
      ? [
          { name: 'afs-mnt', emptyDir: {} },
          { name: 'afs-storage', persistentVolumeClaim: { claimName: AFS_STORAGE_PVC } },
          { name: 'afs-fuse-config', configMap: { name: AFS_CONFIGMAP } },
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
          nodeSelector: AGENT_NODE_SELECTOR,
          ...(IMAGE_PULL_SECRET ? { imagePullSecrets: [{ name: IMAGE_PULL_SECRET }] } : {}),
          containers: [agentContainer, afsSidecar, memoryFuseSidecar].filter(
            (c): c is k8s.V1Container => !!c,
          ),
          volumes,
        },
      },
    },
  }
}

/**
 * Create K8s resources for a workspace
 */
export async function createInstance(
  workspaceId: string,
  agentType = 'claude-code',
  resources?: ComputeResources,
): Promise<K8sInstance> {
  const name = getResourceName(workspaceId)
  const labels = getLabels(workspaceId)
  const pvcName = `${name}-workspace`

  // Create PVC for workspace persistent storage
  const storageSize = resources?.storage || WORKSPACE_STORAGE_SIZE
  await k8sCoreApi.createNamespacedPersistentVolumeClaim(NAMESPACE, {
    apiVersion: 'v1',
    kind: 'PersistentVolumeClaim',
    metadata: { name: pvcName, labels },
    spec: {
      accessModes: ['ReadWriteOnce'],
      storageClassName: AGENT_STORAGE_CLASS,
      resources: { requests: { storage: storageSize } },
    },
  })

  // Create Deployment
  await k8sAppsApi.createNamespacedDeployment(
    NAMESPACE,
    buildDeploymentSpec(name, labels, workspaceId, agentType, pvcName, resources),
  )

  // Create Service (ClusterIP — agents are reached via cluster DNS at
  // tos-<wsId>.<ns>.svc:3001; afs-fuse via :9101)
  await k8sCoreApi.createNamespacedService(NAMESPACE, {
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

/**
 * Get K8s instance by workspace ID
 */
export async function getInstance(workspaceId: string): Promise<K8sInstance | null> {
  const name = getResourceName(workspaceId)

  try {
    const deploymentRes = await k8sAppsApi.readNamespacedDeployment(name, NAMESPACE)
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

/**
 * List all K8s instances
 */
export async function listInstances(): Promise<K8sInstance[]> {
  const response = await k8sAppsApi.listNamespacedDeployment(
    NAMESPACE,
    undefined, // pretty
    undefined, // allowWatchBookmarks
    undefined, // _continue
    undefined, // fieldSelector
    `app=${NAME_PREFIX}`, // labelSelector
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

/**
 * Scale K8s deployment (0 = stopped, 1 = running)
 */
async function scaleInstance(workspaceId: string, replicas: number): Promise<boolean> {
  const name = getResourceName(workspaceId)

  try {
    await k8sAppsApi.patchNamespacedDeploymentScale(
      name,
      NAMESPACE,
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

/**
 * Stop instance (scale to 0)
 */
export async function stopInstance(workspaceId: string): Promise<boolean> {
  return scaleInstance(workspaceId, 0)
}

/**
 * Start/resume instance (scale to 1)
 */
export async function startInstance(workspaceId: string): Promise<boolean> {
  return scaleInstance(workspaceId, 1)
}

/**
 * Roll the instance's pods without changing the Deployment spec — the
 * equivalent of `kubectl rollout restart`. Stamps a template annotation so
 * the Deployment controller recreates the pod (e.g. to re-pull a moving
 * `:latest` tag). Returns false when the Deployment doesn't exist.
 */
export async function restartInstance(workspaceId: string): Promise<boolean> {
  const name = getResourceName(workspaceId)
  try {
    await k8sAppsApi.patchNamespacedDeployment(
      name,
      NAMESPACE,
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

interface InstanceSpecMarkers {
  templateVersion: number | null
  agentImage: string | null
  hasMemoryFuseSidecar: boolean
}

/**
 * Read the markers needed to decide whether a Deployment is in sync with the
 * desired spec: template_version (from annotation), agent image (from the
 * `agent` container), and memory-fuse sidecar presence (from container list).
 * Returns null when no Deployment exists for the workspace.
 */
export async function getInstanceSpecMarkers(
  workspaceId: string,
): Promise<InstanceSpecMarkers | null> {
  const name = getResourceName(workspaceId)
  try {
    const res = await k8sAppsApi.readNamespacedDeployment(name, NAMESPACE)
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
export async function rebuildInstance(
  workspaceId: string,
  agentType: string,
  resources?: ComputeResources,
): Promise<void> {
  const name = getResourceName(workspaceId)
  const labels = getLabels(workspaceId)
  const pvcName = `${name}-workspace`

  // Delete existing deployment
  try {
    await k8sAppsApi.deleteNamespacedDeployment(name, NAMESPACE)
  } catch (e: any) {
    if (e.response?.statusCode !== 404) throw e
  }

  // Recreate deployment with new agent type
  await k8sAppsApi.createNamespacedDeployment(
    NAMESPACE,
    buildDeploymentSpec(name, labels, workspaceId, agentType, pvcName, resources),
  )
}

/**
 * Update Deployment CPU/memory resources (triggers rolling restart)
 */
export async function updateInstanceResources(
  workspaceId: string,
  resources: ComputeResources,
): Promise<boolean> {
  const name = getResourceName(workspaceId)

  try {
    await k8sAppsApi.patchNamespacedDeployment(
      name,
      NAMESPACE,
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

/**
 * Expand PVC storage (only increases, requires StorageClass support)
 */
export async function expandInstanceStorage(
  workspaceId: string,
  newSize: string,
): Promise<boolean> {
  const name = getResourceName(workspaceId)
  const pvcName = `${name}-workspace`

  try {
    await k8sCoreApi.patchNamespacedPersistentVolumeClaim(
      pvcName,
      NAMESPACE,
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

/**
 * Get detailed K8s resource status for a workspace
 */
export async function getInstanceStatus(workspaceId: string): Promise<K8sResourceStatus> {
  const name = getResourceName(workspaceId)
  const labelSelector = `app=${NAME_PREFIX},workspace-id=${workspaceId}`

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
    k8sAppsApi.readNamespacedDeployment(name, NAMESPACE),
    k8sCoreApi.readNamespacedService(name, NAMESPACE),
    k8sCoreApi.readNamespacedPersistentVolumeClaim(pvcName, NAMESPACE),
    k8sCoreApi.listNamespacedPod(
      NAMESPACE,
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
          k8sCoreApi.listNamespacedEvent(
            NAMESPACE,
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
 * Full list of all workspace deployments. Returns deployments indexed by
 * workspace-id plus the response resourceVersion for starting a watch.
 */
export async function listWorkspaceDeployments(timeoutMs = 30_000): Promise<{
  deployments: Map<string, k8s.V1Deployment>
  resourceVersion: string
}> {
  const response = await Promise.race([
    k8sAppsApi.listNamespacedDeployment(
      NAMESPACE,
      undefined,
      undefined,
      undefined,
      undefined,
      `app=${NAME_PREFIX},component=workspace`,
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
export function watchDeployments(
  resourceVersion: string,
  onUpdate: (workspaceId: string, status: ReconciledStatus) => void,
  onError: (err: unknown) => void,
): () => void {
  const watch = new k8s.Watch(kc)
  let aborted = false

  const path = `/apis/apps/v1/namespaces/${NAMESPACE}/deployments`
  const params = { labelSelector: `app=${NAME_PREFIX},component=workspace`, resourceVersion }

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

/**
 * Delete K8s resources for a workspace
 */
export async function deleteInstance(workspaceId: string): Promise<boolean> {
  const name = getResourceName(workspaceId)

  try {
    await Promise.all([
      k8sAppsApi.deleteNamespacedDeployment(name, NAMESPACE),
      k8sCoreApi.deleteNamespacedService(name, NAMESPACE),
      k8sCoreApi.deleteNamespacedPersistentVolumeClaim(`${name}-workspace`, NAMESPACE),
    ])
    return true
  } catch (e: any) {
    if (e.response?.statusCode === 404) {
      return false
    }
    throw e
  }
}
