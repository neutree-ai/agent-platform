import * as k8s from '@kubernetes/client-node'
import type {
  Capabilities,
  EnvironmentProvider,
  ObservedState,
  WorkspaceSpec,
} from '../types/environments'
import { type RuntimeMode, assertNever } from '../types/runtime-mode'
import { WORKSPACE_TOKEN_ENV } from '../types/workspace-token'
import { AutoScalingWorkload } from './auto-scaling-workload'
import { type K8sConfig, defaultCfg } from './config'
import {
  type InstanceSpecMarkers,
  type K8sResourceStatus,
  StaticWorkload,
} from './static-workload'
import { swallow404, workspaceLabels, workspaceSelector, workspaceTokenSecretName } from './support'
import type { WorkspaceWorkload } from './workload'

export type { InstanceSpecMarkers, K8sResourceStatus }

// A pod flipping ready also restates its Deployment/StatefulSet, so events for
// one workspace arrive in bursts; collapse a burst into a single observe.
const WATCH_COALESCE_MS = 200
// Above this many workspaces in one window, read the whole namespace once
// instead of per workspace. A cluster-wide event (rolling restart, node drain)
// moves hundreds of workspaces at once, and one read each would be thousands of
// concurrent apiserver calls — enough to be throttled, which turns a burst of
// events into a burst of DROPPED observations.
const WATCH_BATCH_THRESHOLD = 20
// Backoff before re-establishing a stream that ended, so a persistently failing
// watch (RBAC, apiserver down) cannot spin.
const WATCH_RECONNECT_MS = 2_000

/**
 * Kubernetes provisioning backend.
 *
 * A facade over the two workload shapes. Everything here is shape-independent —
 * the workspace token Secret, the change stream, capabilities — and the shapes
 * themselves live in {@link StaticWorkload} and {@link AutoScalingWorkload}.
 * {@link workloadFor} is the only place they are told apart.
 *
 * Holds its own API clients + config so a remote runner can construct one with
 * injected credentials; the built-in environment uses {@link makeDefaultProvider},
 * which loads from env.
 */
export class KubernetesProvider implements EnvironmentProvider {
  private readonly static: StaticWorkload
  private readonly autoScaling: AutoScalingWorkload

  constructor(
    private readonly appsApi: k8s.AppsV1Api,
    private readonly coreApi: k8s.CoreV1Api,
    private readonly kc: k8s.KubeConfig,
    private readonly cfg: K8sConfig,
  ) {
    this.static = new StaticWorkload(appsApi, coreApi, cfg)
    this.autoScaling = new AutoScalingWorkload(appsApi, coreApi, cfg)
  }

  /**
   * Pick the workload for a runtime mode. The single point where the two shapes
   * are distinguished: adding a third mode fails to compile here until it has a
   * workload of its own.
   */
  private workloadFor(mode: RuntimeMode): WorkspaceWorkload {
    switch (mode) {
      case 'static':
        return this.static
      case 'auto-scaling':
        return this.autoScaling
      default:
        return assertNever(mode)
    }
  }

  async apply(workspaceId: string, spec: WorkspaceSpec): Promise<void> {
    await this.workloadFor(spec.runtimeMode).apply(workspaceId, spec)
  }

  async start(workspaceId: string, mode: RuntimeMode): Promise<void> {
    await this.workloadFor(mode).start(workspaceId)
  }

  async stop(workspaceId: string, mode: RuntimeMode): Promise<void> {
    await this.workloadFor(mode).stop(workspaceId)
  }

  /**
   * Remove everything belonging to a workspace.
   *
   * Deliberately not routed by mode: teardown is the one operation where acting
   * on the wrong shape leaks infra that nothing will ever come back for — the
   * placement row is deleted right after. Both shapes are 404-tolerant, so
   * removing both cannot leak. An environment that cannot host the auto-scaling
   * shape has provably none of it, which is the same reasoning that lets the
   * change stream and the batch observe skip StatefulSets there.
   */
  async destroy(workspaceId: string): Promise<void> {
    await Promise.all([
      this.static.destroy(workspaceId),
      this.cfg.multiReplica ? this.autoScaling.destroy(workspaceId) : Promise.resolve(),
    ])
    // Out here rather than inside either shape: both have a token Secret.
    await this.deleteWorkspaceTokenSecret(workspaceId)
  }

  /**
   * Point-in-time observation.
   *
   * Routed by mode when the caller knows it — the reconcile pass always does,
   * since it holds the placement's spec. Without one, the shapes are tried in
   * turn: a change stream reports that a workspace moved without saying what
   * shape it is, and asking what is actually there is a fair question to answer
   * by looking. The cost of not knowing is one extra read.
   */
  async observe(workspaceId: string, mode?: RuntimeMode): Promise<ObservedState> {
    if (mode) return this.workloadFor(mode).observe(workspaceId)
    const observed = await this.static.observe(workspaceId)
    if (observed.phase !== 'unknown') return observed
    return this.autoScaling.observe(workspaceId)
  }

  /** Both shapes in one pass. A workspace is only ever one, so keys never collide. */
  async observeAll(): Promise<Map<string, ObservedState>> {
    const [staticStates, autoScalingStates] = await Promise.all([
      this.static.observeAll(),
      this.autoScaling.observeAll(),
    ])
    for (const [wsId, state] of autoScalingStates) staticStates.set(wsId, state)
    return staticStates
  }

  /**
   * Stream infra changes as observations.
   *
   * The watches are a change *trigger*, not a second way to compute state: an
   * event only says which workspace moved, and the answer still comes from
   * {@link observe}. That keeps one implementation of "what phase is this
   * workspace in" for both workload shapes, and means a watch can never disagree
   * with a reconcile pass.
   *
   * Three resources are watched because each carries changes the others do not:
   * Pods for readiness, Deployments and StatefulSets for scale 0↔N and for
   * create/delete. Events for one workspace arriving together (a pod flipping
   * ready restates its workload too) are coalesced into one observe.
   *
   * Self-healing: a k8s watch ends routinely (timeout, apiserver restart, a
   * too-old resourceVersion), so each stream reconnects on its own with a
   * backoff. Nothing is lost across a gap — the next observe reads live state,
   * and the reconcile loop's periodic pass is the floor.
   */
  watch(onChange: (workspaceId: string, state: ObservedState) => void): { close(): void } {
    const watcher = new k8s.Watch(this.kc)
    const selector = workspaceSelector(this.cfg)
    let closed = false
    const requests = new Set<{ destroy(): void }>()
    const pending = new Set<string>()
    let flushTimer: ReturnType<typeof setTimeout> | undefined

    const report = (workspaceId: string, state: ObservedState) => {
      if (!closed) onChange(workspaceId, state)
    }

    const flush = async () => {
      flushTimer = undefined
      if (closed || pending.size === 0) return
      const ids = [...pending]
      pending.clear()
      try {
        if (ids.length >= WATCH_BATCH_THRESHOLD) {
          const all = await this.observeAll()
          for (const id of ids) report(id, all.get(id) ?? { phase: 'unknown' })
        } else {
          await Promise.all(
            ids.map((id) => this.observe(id).then((state) => report(id, state))),
          )
        }
      } catch (err) {
        console.error('[k8s-provider] observe after watch events failed:', err)
      }
    }

    const emit = (workspaceId: string) => {
      if (closed) return
      pending.add(workspaceId)
      if (!flushTimer) flushTimer = setTimeout(() => void flush(), WATCH_COALESCE_MS)
    }

    const stream = (path: string) => {
      if (closed) return
      let current: { destroy(): void } | undefined
      watcher
        .watch(
          path,
          { labelSelector: selector },
          (_type, obj: { metadata?: { labels?: { [key: string]: string } } }) => {
            const wsId = obj.metadata?.labels?.['workspace-id']
            if (wsId) emit(wsId)
          },
          (err) => {
            // Drop the finished request before reconnecting; a stream that ends
            // routinely (apiserver timeout / rollout) would otherwise leave one
            // retained socket behind per reconnect for the process's lifetime.
            if (current) requests.delete(current)
            if (closed) return
            if (err) console.warn(`[k8s-provider] watch ${path} ended:`, err)
            setTimeout(() => stream(path), WATCH_RECONNECT_MS)
          },
        )
        .then((req) => {
          current = req
          if (closed) req.destroy()
          else requests.add(req)
        })
        .catch((err) => {
          if (closed) return
          console.error(`[k8s-provider] watch ${path} failed to start:`, err)
          setTimeout(() => stream(path), WATCH_RECONNECT_MS)
        })
    }

    const ns = this.cfg.namespace
    stream(`/api/v1/namespaces/${ns}/pods`)
    stream(`/apis/apps/v1/namespaces/${ns}/deployments`)
    // An environment that cannot host the auto-scaling shape has provably zero
    // StatefulSets, so there is nothing to watch for.
    if (this.cfg.multiReplica) stream(`/apis/apps/v1/namespaces/${ns}/statefulsets`)

    return {
      close() {
        closed = true
        if (flushTimer) clearTimeout(flushTimer)
        pending.clear()
        for (const req of requests) req.destroy()
        requests.clear()
      },
    }
  }

  /**
   * Put the workspace's token in a Secret the pod reads through secretKeyRef.
   *
   * Replaces rather than adopts on conflict: this is called with a fresh token
   * every time the workspace is materialised, so an existing Secret holds the
   * previous one and keeping it would hand the new pod a credential cp is about
   * to retire.
   *
   * The value reaches the container as an env var, so it stays out of the
   * workload spec — which is dumped by `kubectl get`, compared by reconcile, and
   * generally treated as inspectable — and the agent server scrubs it from its
   * environment before spawning anything.
   */
  async deliverWorkspaceToken(workspaceId: string, token: string): Promise<void> {
    const name = workspaceTokenSecretName(this.cfg, workspaceId)
    const body = {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: { name, labels: workspaceLabels(this.cfg, workspaceId) },
      type: 'Opaque',
      stringData: { [WORKSPACE_TOKEN_ENV]: token },
    }
    try {
      await this.coreApi.createNamespacedSecret(this.cfg.namespace, body)
    } catch (e: any) {
      if (e.response?.statusCode !== 409) throw e
      await this.coreApi.replaceNamespacedSecret(name, this.cfg.namespace, body)
    }
  }

  private async deleteWorkspaceTokenSecret(workspaceId: string): Promise<void> {
    await this.coreApi
      .deleteNamespacedSecret(workspaceTokenSecretName(this.cfg, workspaceId), this.cfg.namespace)
      .catch(swallow404)
  }

  capabilities(): Capabilities {
    return {
      sharedFs: this.cfg.afs.enabled,
      persistentMemory: this.cfg.memoryFuseImage !== '',
      multiReplica: this.cfg.multiReplica,
    }
  }

  // ── Live infra reads ──
  // Detail about the objects themselves rather than a workspace's state, for the
  // workspace UI and the admin drift sweep. Deployment-shaped, so they come
  // straight off the static workload.

  getInstanceSpecMarkers(workspaceId: string): Promise<InstanceSpecMarkers | null> {
    return this.static.getInstanceSpecMarkers(workspaceId)
  }

  getInstanceStatus(workspaceId: string): Promise<K8sResourceStatus> {
    return this.static.getInstanceStatus(workspaceId)
  }

  listWorkspaceDeployments(timeoutMs?: number): Promise<Map<string, k8s.V1Deployment>> {
    return this.static.listDeployments(timeoutMs)
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
