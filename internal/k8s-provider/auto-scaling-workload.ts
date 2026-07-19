import * as k8s from '@kubernetes/client-node'
import type { ObservedState, WorkspaceSpec } from '../types/environments'
import type { K8sConfig } from './config'
import {
  createOrAdopt,
  expandWorkspacePvc,
  resourceName,
  swallow404,
  workspaceLabels,
  workspacePvcName,
} from './support'
import {
  CURRENT_TEMPLATE_VERSION,
  TEMPLATE_VERSION_ANNOTATION,
  buildHeadlessServiceSpec,
  buildStatefulSetSpec,
  readyReplicaIdsFromPods,
  resolveStatefulSetStatus,
} from './workspace-spec'

/**
 * The auto-scaling workload shape: a StatefulSet + headless Service + one shared
 * ReadWriteMany PVC. A sibling to the static (Deployment) shape;
 * {@link KubernetesProvider} dispatches to whichever a workspace is — runtime
 * mode is immutable, so a workspace is only ever one. Self-contained over
 * injected api clients + config so it can be unit-tested with fakes. The pod
 * template is byte-identical to the static form (buildWorkspacePodTemplate) —
 * only the surrounding workload / service / PVC differ; StatefulSet is used
 * purely for stable per-ordinal DNS + ordered scale-down.
 */
export class AutoScalingWorkload {
  constructor(
    private readonly appsApi: k8s.AppsV1Api,
    private readonly coreApi: k8s.CoreV1Api,
    private readonly cfg: K8sConfig,
  ) {}

  private async getStatefulSet(workspaceId: string): Promise<k8s.V1StatefulSet | null> {
    const name = resourceName(this.cfg, workspaceId)
    try {
      return (await this.appsApi.readNamespacedStatefulSet(name, this.cfg.namespace)).body
    } catch (e: any) {
      if (e.response?.statusCode === 404) return null
      throw e
    }
  }

  /** Whether this workspace is backed by a StatefulSet (i.e. is auto-scaling). */
  async exists(workspaceId: string): Promise<boolean> {
    return (await this.getStatefulSet(workspaceId)) !== null
  }

  /** Create-or-converge the StatefulSet, headless Service and shared RWX PVC. */
  async apply(workspaceId: string, spec: WorkspaceSpec): Promise<void> {
    const name = resourceName(this.cfg, workspaceId)
    const labels = workspaceLabels(this.cfg, workspaceId)
    const pvcName = workspacePvcName(this.cfg, workspaceId)
    const replicas = spec.replicas ?? 1
    const storageSize = spec.resources?.storage || this.cfg.workspaceStorageSize

    // Shared workspace volume: ReadWriteMany so every replica mounts it at once.
    // Created once — runtime_mode is immutable, so the access mode never changes.
    await createOrAdopt(() =>
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
    await createOrAdopt(() =>
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
      await createOrAdopt(() =>
        this.appsApi.createNamespacedStatefulSet(this.cfg.namespace, desired),
      )
    } else {
      // Converge in place — never delete+recreate, which would take every
      // replica down at once. Strategic-merge the pod template (a rolling update
      // reconciles image/resources) and set the replica count.
      await this.appsApi.patchNamespacedStatefulSet(
        name,
        this.cfg.namespace,
        {
          metadata: {
            annotations: {
              [TEMPLATE_VERSION_ANNOTATION]: String(CURRENT_TEMPLATE_VERSION),
            },
          },
          spec: { replicas, template: desired.spec?.template },
        },
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          headers: { 'Content-Type': 'application/strategic-merge-patch+json' },
        },
      )
    }

    if (spec.resources?.storage) {
      await expandWorkspacePvc(this.coreApi, this.cfg, pvcName, spec.resources.storage)
    }
  }

  /** Scale the StatefulSet; 404-tolerant (false when it doesn't exist). */
  async scale(workspaceId: string, replicas: number): Promise<boolean> {
    const name = resourceName(this.cfg, workspaceId)
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

  /**
   * Wake the StatefulSet to a floor of 1 replica; the autoscaler reconciles to
   * the true desired on its next tick. (The primary wake path is apply() with
   * spec.replicas — this covers a bare stopped→running phase flip with no spec
   * bump.)
   */
  async start(workspaceId: string): Promise<void> {
    await this.scale(workspaceId, 1)
  }

  async stop(workspaceId: string): Promise<void> {
    await this.scale(workspaceId, 0)
  }

  async destroy(workspaceId: string): Promise<void> {
    const name = resourceName(this.cfg, workspaceId)
    await Promise.all([
      this.appsApi.deleteNamespacedStatefulSet(name, this.cfg.namespace).catch(swallow404),
      this.coreApi.deleteNamespacedService(`${name}-hl`, this.cfg.namespace).catch(swallow404),
      this.coreApi
        .deleteNamespacedPersistentVolumeClaim(
          workspacePvcName(this.cfg, workspaceId),
          this.cfg.namespace,
        )
        .catch(swallow404),
    ])
  }

  /** The observed state (phase + ready replica set on the endpoint) for a set. */
  private observed(name: string, sts: k8s.V1StatefulSet, pods: k8s.V1Pod[]): ObservedState {
    return {
      phase: resolveStatefulSetStatus(sts),
      endpoint: {
        address: `${name}-hl.${this.cfg.namespace}.svc.cluster.local:3001`,
        readyReplicaIds: readyReplicaIdsFromPods(pods, name),
      },
    }
  }

  /** Observe one workspace: phase + ready replica set (on the endpoint). */
  async observe(workspaceId: string): Promise<ObservedState> {
    const name = resourceName(this.cfg, workspaceId)
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
    return this.observed(name, sts, pods.body.items)
  }

  /** Batch counterpart: every StatefulSet-backed (auto-scaling) workspace. */
  async observeAll(): Promise<Map<string, ObservedState>> {
    const out = new Map<string, ObservedState>()
    // Environments that can't host the shape have provably zero StatefulSets —
    // skip the LIST entirely rather than pay it every reconcile pass.
    if (!this.cfg.multiReplica) return out

    const res = await this.appsApi.listNamespacedStatefulSet(
      this.cfg.namespace,
      undefined,
      undefined,
      undefined,
      undefined,
      `app=${this.cfg.namePrefix},component=workspace`,
    )
    const sets = res.body.items.filter((s) => s.metadata?.labels?.['workspace-id'])
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
      const list = podsByWs.get(wsId) ?? []
      list.push(pod)
      podsByWs.set(wsId, list)
    }

    for (const sts of sets) {
      const wsId = sts.metadata?.labels?.['workspace-id'] as string
      out.set(wsId, this.observed(resourceName(this.cfg, wsId), sts, podsByWs.get(wsId) ?? []))
    }
    return out
  }
}
