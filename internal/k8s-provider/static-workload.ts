import type * as k8s from '@kubernetes/client-node'
import type { ComputeResources } from '../types/api'
import type { ObservedPhase, ObservedState, WorkspaceSpec } from '../types/environments'
import type { K8sConfig } from './config'
import {
  MERGE_PATCH,
  createOrAdopt,
  expandWorkspacePvc,
  isPodReady,
  resourceName,
  scaleWorkload,
  swallow404,
  workspaceLabels,
  workspacePvcName,
  workspaceSelector,
} from './support'
import type { WorkspaceWorkload } from './workload'
import {
  AGENT_PORT,
  MEMORY_FUSE_CONTAINER_NAME,
  WORKSPACE_SERVICE_PORTS,
  buildDeploymentSpec,
  resolveDeploymentStatus,
  workloadTemplateVersion,
} from './workspace-spec'

/** Live detail of a workspace's Kubernetes objects, for the workspace UI. */
export interface K8sResourceStatus {
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

/** What a drift check compares a running Deployment against its desired spec by. */
export interface InstanceSpecMarkers {
  templateVersion: number | null
  agentImage: string | null
  hasMemoryFuseSidecar: boolean
}

const SERVICE_MISSING_MESSAGE =
  'Service missing — workspace is running but unreachable via cluster DNS'

/**
 * The static workload shape: one Deployment replica on a ReadWriteOnce volume,
 * behind a ClusterIP Service. Sibling of {@link AutoScalingWorkload}; the pod
 * template is shared with it (buildWorkspacePodTemplate, via buildDeploymentSpec)
 * so only the surrounding workload and Service differ.
 */
export class StaticWorkload implements WorkspaceWorkload {
  constructor(
    private readonly appsApi: k8s.AppsV1Api,
    private readonly coreApi: k8s.CoreV1Api,
    private readonly cfg: K8sConfig,
  ) {}

  private name(workspaceId: string): string {
    return resourceName(this.cfg, workspaceId)
  }

  private labels(workspaceId: string): Record<string, string> {
    return workspaceLabels(this.cfg, workspaceId)
  }

  /**
   * Create the workspace's ClusterIP Service if it isn't there (agents are
   * reached via cluster DNS at `<prefix>-<wsId>.<ns>.svc:3001`; afs-fuse via
   * :9101). Idempotent — a 409 means it already exists.
   *
   * Called from every converge path, not just create: the Service is the one
   * workspace resource whose creation can fail for a *cluster-wide* reason
   * (ClusterIP range exhausted) rather than a per-workspace one, so a workspace
   * can outlive its Service. Without a repair on start()/apply(), such a
   * workspace stays unreachable forever — its Deployment is healthy, so nothing
   * in reconcile ever fires.
   */
  private async ensureService(workspaceId: string): Promise<void> {
    const name = this.name(workspaceId)
    const labels = this.labels(workspaceId)
    await createOrAdopt(() =>
      this.coreApi.createNamespacedService(this.cfg.namespace, {
        apiVersion: 'v1',
        kind: 'Service',
        metadata: { name, labels },
        spec: {
          selector: labels,
          ports: WORKSPACE_SERVICE_PORTS,
          type: 'ClusterIP',
        },
      }),
    )
  }

  private async getDeployment(workspaceId: string): Promise<k8s.V1Deployment | null> {
    try {
      return (
        await this.appsApi.readNamespacedDeployment(this.name(workspaceId), this.cfg.namespace)
      ).body
    } catch (e: any) {
      swallow404(e)
      return null
    }
  }

  /** Create the PVC, Service and Deployment for a workspace that has none. */
  private async create(
    workspaceId: string,
    agentType: string,
    resources?: ComputeResources,
  ): Promise<void> {
    const name = this.name(workspaceId)
    const labels = this.labels(workspaceId)
    const pvcName = workspacePvcName(this.cfg, workspaceId)

    const storageSize = resources?.storage || this.cfg.workspaceStorageSize
    await createOrAdopt(() =>
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

    // Service before Deployment: it is the step that can fail on a cluster-wide
    // resource (ClusterIP range full). Creating it first means such a failure
    // leaves no Deployment behind — observe() reports 'unknown' and reconcile
    // keeps retrying, instead of a running-but-unreachable workspace nothing
    // ever re-converges.
    await this.ensureService(workspaceId)

    // A 409 here can only be a race with a concurrent create building the same
    // fresh spec (a pre-existing Deployment routes apply() to rebuild instead),
    // so adopting is safe.
    await createOrAdopt(() =>
      this.appsApi.createNamespacedDeployment(
        this.cfg.namespace,
        buildDeploymentSpec(name, labels, workspaceId, agentType, pvcName, resources, this.cfg),
      ),
    )
  }

  /**
   * Swap the Deployment for one built from the current spec, preserving the PVC
   * and Service — the workspace keeps its data and its address across a rebuild.
   */
  private async rebuild(
    workspaceId: string,
    agentType: string,
    resources?: ComputeResources,
  ): Promise<void> {
    const name = this.name(workspaceId)
    const labels = this.labels(workspaceId)
    const pvcName = workspacePvcName(this.cfg, workspaceId)

    await this.appsApi.deleteNamespacedDeployment(name, this.cfg.namespace).catch(swallow404)
    await this.appsApi.createNamespacedDeployment(
      this.cfg.namespace,
      buildDeploymentSpec(name, labels, workspaceId, agentType, pvcName, resources, this.cfg),
    )
  }

  /** Scale the Deployment; 404-tolerant (false when it doesn't exist). */
  private async scale(workspaceId: string, replicas: number): Promise<boolean> {
    return scaleWorkload(() =>
      this.appsApi.patchNamespacedDeploymentScale(
        this.name(workspaceId),
        this.cfg.namespace,
        { spec: { replicas } },
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        MERGE_PATCH,
      ),
    )
  }

  /** Expand the workspace PVC (grow-only, 404/shrink-tolerant). */
  private async expandStorage(workspaceId: string, newSize: string): Promise<boolean> {
    return expandWorkspacePvc(
      this.coreApi,
      this.cfg,
      workspacePvcName(this.cfg, workspaceId),
      newSize,
    )
  }

  async apply(workspaceId: string, spec: WorkspaceSpec): Promise<void> {
    if ((await this.getDeployment(workspaceId)) === null) {
      await this.create(workspaceId, spec.agentType, spec.resources)
      return
    }
    // A rebuild swaps the Deployment (new container resources/image) but keeps
    // the PVC, so storage grows separately when the spec asks for it (expand only
    // ever increases; same-size is a no-op).
    await this.ensureService(workspaceId)
    await this.rebuild(workspaceId, spec.agentType, spec.resources)
    if (spec.resources?.storage) await this.expandStorage(workspaceId, spec.resources.storage)
  }

  /**
   * Scale back to one replica, repairing the Service on the way: a stopped
   * workspace keeps its Service while scaled to 0, but that Service may have been
   * reclaimed (or never created), and waking the pod alone would leave it
   * unreachable.
   */
  async start(workspaceId: string): Promise<void> {
    if (!(await this.scale(workspaceId, 1))) return
    await this.ensureService(workspaceId)
  }

  /**
   * Scale to zero and release the ClusterIP. A stopped workspace routes nothing,
   * but its Service holds an address out of a range that is finite and
   * cluster-wide (a /22 is 1022 of them) — with stopped workspaces typically
   * outnumbering running ones, holding those is what exhausts the range and
   * starves *new* workspaces. start() recreates it on the way up, which is what
   * makes releasing it safe.
   */
  async stop(workspaceId: string): Promise<void> {
    if (!(await this.scale(workspaceId, 0))) return
    await this.coreApi
      .deleteNamespacedService(this.name(workspaceId), this.cfg.namespace)
      .catch(swallow404)
  }

  async destroy(workspaceId: string): Promise<void> {
    const name = this.name(workspaceId)
    await Promise.all([
      this.appsApi.deleteNamespacedDeployment(name, this.cfg.namespace).catch(swallow404),
      this.coreApi.deleteNamespacedService(name, this.cfg.namespace).catch(swallow404),
      this.coreApi
        .deleteNamespacedPersistentVolumeClaim(
          workspacePvcName(this.cfg, workspaceId),
          this.cfg.namespace,
        )
        .catch(swallow404),
    ])
  }

  /** The observed state of one Deployment, given whether its Service is there. */
  private observed(
    workspaceId: string,
    dep: k8s.V1Deployment,
    hasService: boolean,
  ): ObservedState {
    const deployPhase = resolveDeploymentStatus(dep)
    // Running with no Service is up but unreachable over cluster DNS — a failure
    // the phase alone would hide.
    const phase: ObservedPhase = deployPhase === 'running' && !hasService ? 'error' : deployPhase
    const templateVersion = workloadTemplateVersion(dep)
    return {
      phase,
      endpoint: {
        address: `${this.name(workspaceId)}.${this.cfg.namespace}.svc.cluster.local:${AGENT_PORT}`,
        // One replica, id 0, ready exactly when the workspace is reachable. Both
        // shapes report a set, so reachability is one uniform signal: what cp
        // routes on, sizes turn capacity from, and fans reloads out over.
        readyReplicaIds: phase === 'running' ? [0] : [],
      },
      ...(templateVersion !== null ? { templateVersion } : {}),
      ...(phase === 'error' && deployPhase === 'running'
        ? { message: SERVICE_MISSING_MESSAGE }
        : {}),
    }
  }

  async observe(workspaceId: string): Promise<ObservedState> {
    const dep = await this.getDeployment(workspaceId)
    if (!dep) return { phase: 'unknown' }
    // Only pay for the Service read when its absence would change the answer.
    const hasService =
      resolveDeploymentStatus(dep) !== 'running' ||
      (await this.coreApi
        .readNamespacedService(this.name(workspaceId), this.cfg.namespace)
        .then(() => true)
        .catch((e: any) => {
          swallow404(e)
          return false
        }))
    return this.observed(workspaceId, dep, hasService)
  }

  /**
   * Two LISTs, not one: the Service set is fetched alongside the Deployments so
   * the running-but-unreachable case is caught here too, still in O(1)
   * round-trips per pass.
   */
  async observeAll(): Promise<Map<string, ObservedState>> {
    const [deployments, services] = await Promise.all([
      this.listDeployments(),
      this.listServiceIds(),
    ])
    const out = new Map<string, ObservedState>()
    for (const [wsId, dep] of deployments) {
      out.set(wsId, this.observed(wsId, dep, services.has(wsId)))
    }
    return out
  }

  /** Every workspace Deployment in the namespace, indexed by workspace id. */
  async listDeployments(timeoutMs = 30_000): Promise<Map<string, k8s.V1Deployment>> {
    const response = await withTimeout(
      this.appsApi.listNamespacedDeployment(
        this.cfg.namespace,
        undefined,
        undefined,
        undefined,
        undefined,
        workspaceSelector(this.cfg),
      ),
      timeoutMs,
      'listDeployments',
    )

    const deployments = new Map<string, k8s.V1Deployment>()
    for (const dep of response.body.items) {
      const wsId = dep.metadata?.labels?.['workspace-id']
      if (wsId) deployments.set(wsId, dep)
    }
    return deployments
  }

  /**
   * The workspace-ids that currently have a ClusterIP Service. Only the ids are
   * kept, since every caller asks "does this workspace have one" and nothing else.
   */
  private async listServiceIds(timeoutMs = 30_000): Promise<Set<string>> {
    const response = await withTimeout(
      this.coreApi.listNamespacedService(
        this.cfg.namespace,
        undefined,
        undefined,
        undefined,
        undefined,
        workspaceSelector(this.cfg),
      ),
      timeoutMs,
      'listServiceIds',
    )

    const ids = new Set<string>()
    for (const svc of response.body.items) {
      // Skip the auto-scaling headless Service (`<name>-hl`), which carries the
      // same labels but is not the ClusterIP one this check is about.
      if (svc.spec?.clusterIP === 'None') continue
      const wsId = svc.metadata?.labels?.['workspace-id']
      if (wsId) ids.add(wsId)
    }
    return ids
  }

  /**
   * Read the markers a drift check compares against the desired spec: template
   * version (annotation), agent image (the `agent` container), and memory-fuse
   * sidecar presence. Null when no Deployment exists for the workspace.
   */
  async getInstanceSpecMarkers(workspaceId: string): Promise<InstanceSpecMarkers | null> {
    const dep = await this.getDeployment(workspaceId)
    if (!dep) return null
    const containers = dep.spec?.template?.spec?.containers ?? []
    const agent = containers.find((c) => c.name === 'agent')
    return {
      templateVersion: workloadTemplateVersion(dep),
      agentImage: agent?.image ?? null,
      hasMemoryFuseSidecar: containers.some((c) => c.name === MEMORY_FUSE_CONTAINER_NAME),
    }
  }

  /** Detailed live status of a workspace's Kubernetes objects, for the UI. */
  async getInstanceStatus(workspaceId: string): Promise<K8sResourceStatus> {
    const name = this.name(workspaceId)
    const labelSelector = `app=${this.cfg.namePrefix},workspace-id=${workspaceId}`

    const result: K8sResourceStatus = {
      deployment: { exists: false, ready: false, replicas: 0, readyReplicas: 0 },
      service: { exists: false },
      pvc: { exists: false },
      pods: { total: 0, ready: 0 },
      warnings: [],
      conditions: [],
    }

    const [depResult, svcResult, pvcResult, podsResult] = await Promise.allSettled([
      this.appsApi.readNamespacedDeployment(name, this.cfg.namespace),
      this.coreApi.readNamespacedService(name, this.cfg.namespace),
      this.coreApi.readNamespacedPersistentVolumeClaim(
        workspacePvcName(this.cfg, workspaceId),
        this.cfg.namespace,
      ),
      this.coreApi.listNamespacedPod(
        this.cfg.namespace,
        undefined,
        undefined,
        undefined,
        undefined,
        labelSelector,
      ),
    ])

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

      for (const c of dep.status?.conditions ?? []) {
        if (c.type !== 'Available' && c.type !== 'Progressing') continue
        // Available=False/MinimumReplicasUnavailable is the transient state of a
        // rolling update, where old pods are terminating and new ones are not
        // ready yet. Surfacing it makes the settings page flash red during a
        // routine scale-up.
        if (
          c.type === 'Available' &&
          c.status !== 'True' &&
          c.reason === 'MinimumReplicasUnavailable'
        ) {
          continue
        }
        result.conditions.push({ type: c.type, status: c.status === 'True', message: c.message })
      }
    } else if ((depResult.reason as any)?.response?.statusCode !== 404) {
      result.conditions.push({
        type: 'DeploymentError',
        status: false,
        message: depResult.reason?.message,
      })
    }

    if (svcResult.status === 'fulfilled') {
      result.service = { exists: true }
    } else if ((svcResult.reason as any)?.response?.statusCode !== 404) {
      result.conditions.push({
        type: 'ServiceError',
        status: false,
        message: svcResult.reason?.message,
      })
    }

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

    if (podsResult.status === 'fulfilled') {
      const pods = podsResult.value.body.items
      const podNames: string[] = []
      for (const pod of pods) {
        podNames.push(pod.metadata?.name || '')
        result.pods.total++
        if (isPodReady(pod)) result.pods.ready++
      }
      if (podNames.length > 0) {
        result.warnings = await this.podWarnings(podNames)
      }
    }

    return result
  }

  /** Distinct Warning events across a workspace's pods, capped for the UI. */
  private async podWarnings(
    podNames: string[],
  ): Promise<Array<{ reason: string; message: string }>> {
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

    const seen = new Set<string>()
    const warnings: Array<{ reason: string; message: string }> = []
    for (const eventResult of eventResults) {
      if (eventResult.status !== 'fulfilled') continue
      for (const event of eventResult.value.body.items) {
        if (event.type !== 'Warning') continue
        const key = `${event.reason}:${event.message}`
        if (seen.has(key)) continue
        seen.add(key)
        warnings.push({ reason: event.reason || '', message: event.message || '' })
      }
    }
    return warnings.slice(0, 5)
  }
}

/** Reject a k8s list that outruns its budget, so a pass cannot hang on one. */
function withTimeout<T>(call: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    call,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ])
}
