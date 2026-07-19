import * as k8s from '@kubernetes/client-node'
import type { ComputeResources } from '../types/api'
import type {
  Capabilities,
  EnvironmentProvider,
  ObservedState,
  WorkspaceSpec,
} from '../types/environments'
import { type K8sConfig, defaultCfg } from './config'
import {
  CURRENT_TEMPLATE_VERSION,
  MEMORY_FUSE_CONTAINER_NAME,
  type ReconciledStatus,
  TEMPLATE_VERSION_ANNOTATION,
  buildDeploymentSpec,
  buildHeadlessServiceSpec,
  buildStatefulSetSpec,
  readyReplicaIdsFromPods,
  resolveDeploymentStatus,
  resolveStatefulSetStatus,
} from './workspace-spec'

/** A delete/read whose 404 means "already gone" = success; rethrow the rest. */
function swallow404(e: any): void {
  if (e.response?.statusCode !== 404) throw e
}

const STORAGE_UNITS: Record<string, number> = {
  Ki: 2 ** 10,
  Mi: 2 ** 20,
  Gi: 2 ** 30,
  Ti: 2 ** 40,
  Pi: 2 ** 50,
  Ei: 2 ** 60,
  K: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  P: 1e15,
  E: 1e18,
}

/** Parse a k8s resource quantity string (e.g. "50Gi", "100000000") into bytes. */
function parseStorageQuantity(quantity: string): number {
  const match = quantity.match(/^([0-9.]+)([A-Za-z]*)$/)
  if (!match) throw new Error(`Unparseable storage quantity: ${quantity}`)
  const [, num, unit] = match
  const multiplier = unit ? STORAGE_UNITS[unit] : 1
  if (multiplier === undefined) throw new Error(`Unknown storage unit: ${unit}`)
  return Number(num) * multiplier
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

interface InstanceSpecMarkers {
  templateVersion: number | null
  agentImage: string | null
  hasMemoryFuseSidecar: boolean
}

/**
 * Kubernetes provisioning backend. Holds its own API clients + config so a
 * remote runner can construct one with injected credentials/config; the
 * built-in environment uses the provider from {@link makeDefaultProvider},
 * which loads from env. Lifecycle methods are the same logic that used to
 * live in module-level functions — control-plane keeps thin wrappers over a
 * default instance so existing call sites stay unchanged.
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

  /**
   * Run a create call, adopting an already-existing object instead of failing.
   * createInstance must be idempotent: the reconcile loop re-enters it every
   * tick while a workspace is unconverged, and the PVC/Service deliberately
   * outlive the Deployment (rebuildInstance, manual Deployment deletion). A
   * bare create would 409 on the survivors forever and deadlock the reconcile.
   */
  private async createOrAdopt(create: () => Promise<unknown>): Promise<void> {
    try {
      await create()
    } catch (e: any) {
      if (e.response?.statusCode !== 409) throw e
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
    await this.createOrAdopt(() =>
      this.coreApi.createNamespacedPersistentVolumeClaim(this.cfg.namespace, {
        apiVersion: 'v1',
        kind: 'PersistentVolumeClaim',
        metadata: { name: pvcName, labels },
        spec: {
          accessModes: ['ReadWriteOnce'],
          storageClassName: this.cfg.storageClass,
          resources: { requests: { storage: storageSize } },
        },
      }),
    )

    // Create Deployment. A 409 here can only be a race with a concurrent
    // create building the same fresh spec (a pre-existing Deployment routes
    // apply() to rebuildInstance instead), so adopting is safe.
    await this.createOrAdopt(() =>
      this.appsApi.createNamespacedDeployment(
        this.cfg.namespace,
        buildDeploymentSpec(name, labels, workspaceId, agentType, pvcName, resources, this.cfg),
      ),
    )

    // Create Service (ClusterIP — agents are reached via cluster DNS at
    // <prefix>-<wsId>.<ns>.svc:3001; afs-fuse via :9101)
    await this.createOrAdopt(() =>
      this.coreApi.createNamespacedService(this.cfg.namespace, {
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
      }),
    )

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

  /**
   * Expand PVC storage. K8s only ever allows a PVC to grow, never shrink —
   * patching a smaller size is rejected by the API. A desired spec asking for
   * less than what's provisioned (e.g. a stale/lowered compute_resources
   * value) is treated as a no-op here rather than an error, so it can't block
   * spec convergence for every other field forever (see incident: apply()
   * threw on this every reconcile pass, tearing down and recreating the
   * Deployment before the new pod could ever pass its startup probe).
   */
  async expandInstanceStorage(workspaceId: string, newSize: string): Promise<boolean> {
    const name = this.getResourceName(workspaceId)
    const pvcName = `${name}-workspace`

    try {
      const current = await this.coreApi.readNamespacedPersistentVolumeClaim(
        pvcName,
        this.cfg.namespace,
      )
      const currentSize = current.body.spec?.resources?.requests?.storage
      if (currentSize && parseStorageQuantity(newSize) <= parseStorageQuantity(currentSize)) {
        return true
      }
    } catch (e: any) {
      if (e.response?.statusCode === 404) return false
      throw e
    }

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

  // ── Auto-scaling (StatefulSet) form ──
  // A workspace with runtimeMode 'auto-scaling' is backed by a StatefulSet +
  // headless Service + one shared RWX PVC, instead of a Deployment + ClusterIP
  // Service + RWO PVC. runtime_mode is immutable, so a given workspace is only
  // ever one shape; these private methods handle the auto-scaling shape and the
  // facade below dispatches to them (detecting the shape from what exists, since
  // observe/stop/destroy aren't handed the spec). The pod template is identical
  // to the static form — only the surrounding workload/service/PVC differ.

  private async getStatefulSet(workspaceId: string): Promise<k8s.V1StatefulSet | null> {
    const name = this.getResourceName(workspaceId)
    try {
      return (await this.appsApi.readNamespacedStatefulSet(name, this.cfg.namespace)).body
    } catch (e: any) {
      if (e.response?.statusCode === 404) return null
      throw e
    }
  }

  /** Create-or-converge the StatefulSet, headless Service and shared RWX PVC. */
  private async applyStatefulSet(workspaceId: string, spec: WorkspaceSpec): Promise<void> {
    const name = this.getResourceName(workspaceId)
    const labels = this.getLabels(workspaceId)
    const pvcName = `${name}-workspace`
    const replicas = spec.replicas ?? 1
    const storageSize = spec.resources?.storage || this.cfg.workspaceStorageSize

    // Shared workspace volume: ReadWriteMany so every replica mounts it at once.
    // Created once — runtime_mode is immutable, so the access mode never changes.
    await this.createOrAdopt(() =>
      this.coreApi.createNamespacedPersistentVolumeClaim(this.cfg.namespace, {
        apiVersion: 'v1',
        kind: 'PersistentVolumeClaim',
        metadata: { name: pvcName, labels },
        spec: {
          accessModes: ['ReadWriteMany'],
          storageClassName: this.cfg.storageClass,
          resources: { requests: { storage: storageSize } },
        },
      }),
    )

    // Headless Service for stable per-ordinal DNS (no ClusterIP — a VIP would
    // round-robin across replicas and defeat session affinity).
    await this.createOrAdopt(() =>
      this.coreApi.createNamespacedService(
        this.cfg.namespace,
        buildHeadlessServiceSpec(name, labels),
      ),
    )

    const desired = buildStatefulSetSpec(
      name,
      labels,
      workspaceId,
      spec.agentType,
      pvcName,
      replicas,
      spec.resources,
      this.cfg,
    )
    const existing = await this.getStatefulSet(workspaceId)
    if (!existing) {
      await this.createOrAdopt(() =>
        this.appsApi.createNamespacedStatefulSet(this.cfg.namespace, desired),
      )
    } else {
      // Converge in place — never delete+recreate, which would take every
      // replica down at once. Strategic-merge the pod template (a rolling
      // update reconciles image/resources) and set the replica count.
      await this.appsApi.patchNamespacedStatefulSet(
        name,
        this.cfg.namespace,
        {
          metadata: {
            annotations: { [TEMPLATE_VERSION_ANNOTATION]: String(CURRENT_TEMPLATE_VERSION) },
          },
          spec: { replicas, template: desired.spec?.template },
        },
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { headers: { 'Content-Type': 'application/strategic-merge-patch+json' } },
      )
    }

    if (spec.resources?.storage) {
      await this.expandInstanceStorage(workspaceId, spec.resources.storage)
    }
  }

  /** Scale a StatefulSet workspace; 404-tolerant (false when it doesn't exist). */
  private async scaleStatefulSet(workspaceId: string, replicas: number): Promise<boolean> {
    const name = this.getResourceName(workspaceId)
    try {
      await this.appsApi.patchNamespacedStatefulSetScale(
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
      if (e.response?.statusCode === 404) return false
      throw e
    }
  }

  /** Observe one StatefulSet workspace: phase + replica counts + ready ids. */
  private async observeStatefulSet(workspaceId: string): Promise<ObservedState> {
    const name = this.getResourceName(workspaceId)
    const sts = await this.getStatefulSet(workspaceId)
    if (!sts) return { phase: 'unknown' }

    const pods = await this.coreApi.listNamespacedPod(
      this.cfg.namespace,
      undefined,
      undefined,
      undefined,
      undefined,
      `app=${this.cfg.namePrefix},workspace-id=${workspaceId}`,
    )
    return {
      phase: resolveStatefulSetStatus(sts),
      endpoint: {
        address: `${name}-hl.${this.cfg.namespace}.svc.cluster.local:3001`,
        readyReplicaIds: readyReplicaIdsFromPods(pods.body.items, name),
        desiredReplicas: sts.spec?.replicas ?? 0,
      },
    }
  }

  /** Batch counterpart: every StatefulSet-backed (auto-scaling) workspace. */
  private async observeAllStatefulSets(): Promise<Map<string, ObservedState>> {
    const res = await this.appsApi.listNamespacedStatefulSet(
      this.cfg.namespace,
      undefined,
      undefined,
      undefined,
      undefined,
      `app=${this.cfg.namePrefix},component=workspace`,
    )
    const sets = res.body.items.filter((s) => s.metadata?.labels?.['workspace-id'])
    const out = new Map<string, ObservedState>()
    if (sets.length === 0) return out

    // One pod LIST across all auto-scaling workspaces, bucketed by workspace-id.
    const pods = await this.coreApi.listNamespacedPod(
      this.cfg.namespace,
      undefined,
      undefined,
      undefined,
      undefined,
      `app=${this.cfg.namePrefix},component=workspace`,
    )
    const podsByWs = new Map<string, k8s.V1Pod[]>()
    for (const pod of pods.body.items) {
      const wsId = pod.metadata?.labels?.['workspace-id']
      if (!wsId) continue
      const list = podsByWs.get(wsId)
      if (list) list.push(pod)
      else podsByWs.set(wsId, [pod])
    }

    for (const sts of sets) {
      const wsId = sts.metadata?.labels?.['workspace-id'] as string
      const name = this.getResourceName(wsId)
      out.set(wsId, {
        phase: resolveStatefulSetStatus(sts),
        endpoint: {
          address: `${name}-hl.${this.cfg.namespace}.svc.cluster.local:3001`,
          readyReplicaIds: readyReplicaIdsFromPods(podsByWs.get(wsId) ?? [], name),
          desiredReplicas: sts.spec?.replicas ?? 0,
        },
      })
    }
    return out
  }

  /** Delete a StatefulSet workspace's resources (StatefulSet + headless svc + PVC). */
  private async deleteStatefulSetInstance(workspaceId: string): Promise<void> {
    const name = this.getResourceName(workspaceId)
    await Promise.all([
      this.appsApi.deleteNamespacedStatefulSet(name, this.cfg.namespace).catch(swallow404),
      this.coreApi.deleteNamespacedService(`${name}-hl`, this.cfg.namespace).catch(swallow404),
      this.coreApi
        .deleteNamespacedPersistentVolumeClaim(`${name}-workspace`, this.cfg.namespace)
        .catch(swallow404),
    ])
  }

  // ── EnvironmentProvider interface ──
  // Infra-agnostic facade over the methods above, consumed by the runner. The
  // legacy methods stay (their callers are unchanged); these adapt signatures
  // to WorkspaceSpec / ObservedState. Lifecycle methods discard the legacy
  // boolean return (false = "no such Deployment", which is a no-op for an
  // idempotent converge).

  /** Create if absent, else rebuild to converge (v1: cp bumps version → rebuild). */
  async apply(workspaceId: string, spec: WorkspaceSpec): Promise<void> {
    if (spec.runtimeMode === 'auto-scaling') {
      await this.applyStatefulSet(workspaceId, spec)
      return
    }
    const existing = await this.getInstance(workspaceId)
    if (existing) {
      // rebuild swaps the Deployment (new container resources/image) but
      // preserves the PVC, so grow storage separately when the spec asks for it
      // (expand only ever increases; same-size is a no-op).
      await this.rebuildInstance(workspaceId, spec.agentType, spec.resources)
      if (spec.resources?.storage) {
        await this.expandInstanceStorage(workspaceId, spec.resources.storage)
      }
    } else {
      await this.createInstance(workspaceId, spec.agentType, spec.resources)
    }
  }

  async start(workspaceId: string): Promise<void> {
    // Detect the shape by what exists (no spec here). A static workspace scales
    // its Deployment 0→1; startInstance returns false (404) when there is none,
    // i.e. an auto-scaling workspace, whose StatefulSet we wake instead.
    const started = await this.startInstance(workspaceId)
    if (!started) {
      // Wake the StatefulSet to a floor of 1 replica; the autoscaler reconciles
      // to the true desired on its next tick. (The primary wake path is apply()
      // with spec.replicas — this covers a bare stopped→running phase flip with
      // no spec bump.) scaleStatefulSet is 404-tolerant, so a workspace with
      // neither shape is a no-op, exactly as before.
      await this.scaleStatefulSet(workspaceId, 1)
    }
  }

  async stop(workspaceId: string): Promise<void> {
    // runtime_mode isn't passed here — detect the form by what exists. A static
    // workspace scales its Deployment; stopInstance returns false (404) when
    // there is none, i.e. an auto-scaling workspace, whose StatefulSet we scale.
    const scaled = await this.stopInstance(workspaceId)
    if (!scaled) await this.scaleStatefulSet(workspaceId, 0)
  }

  async destroy(workspaceId: string): Promise<void> {
    // A StatefulSet-backed workspace has no Deployment/ClusterIP Service to
    // delete; route teardown by the shape that actually exists.
    const sts = await this.getStatefulSet(workspaceId)
    if (sts) await this.deleteStatefulSetInstance(workspaceId)
    else await this.deleteInstance(workspaceId)
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
        // No Deployment — maybe an auto-scaling (StatefulSet) workspace.
        return this.observeStatefulSet(workspaceId)
      }
      throw e
    }
  }

  /**
   * Batch counterpart to {@link observe}: a single LIST over all workspace
   * deployments instead of one GET per workspace. Mirrors observe()'s shape
   * (status + cluster-DNS endpoint); workspaces with no deployment are simply
   * absent from the map (the reconcile loop treats them as 'unknown', exactly
   * as observe()'s 404 path does).
   */
  async observeAll(): Promise<Map<string, ObservedState>> {
    const { deployments } = await this.listWorkspaceDeployments()
    const out = new Map<string, ObservedState>()
    for (const [wsId, dep] of deployments) {
      const name = this.getResourceName(wsId)
      out.set(wsId, {
        phase: resolveDeploymentStatus(dep),
        endpoint: {
          address: `${name}.${this.cfg.namespace}.svc.cluster.local:3001`,
        },
      })
    }
    // Merge in auto-scaling (StatefulSet) workspaces. A workspace is only ever
    // one shape, so keys never collide.
    for (const [wsId, state] of await this.observeAllStatefulSets()) {
      out.set(wsId, state)
    }
    return out
  }

  capabilities(): Capabilities {
    return {
      sharedFs: this.cfg.afs.enabled,
      persistentMemory: this.cfg.memoryFuseImage !== '',
      multiReplica: this.cfg.multiReplica,
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
