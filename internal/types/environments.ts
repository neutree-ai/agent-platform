/**
 * Shared environment-provisioning contract types (BYOI).
 *
 * An *environment* is a place where workspaces are provisioned. The control
 * plane publishes desired state per workspace and a *runner* — in-process for
 * the built-in environment, remote for BYOI — reconciles it against an
 * {@link EnvironmentProvider} implementation (KubernetesProvider being the
 * first). These types are the infra-agnostic seam between the two halves.
 */

import type { ComputeResources } from './api.js'
import type { RuntimeMode } from './runtime-mode.js'

/** Provisioning backend kind. Open-ended; KubernetesProvider is the first. */
export type EnvironmentKind = 'kubernetes' | 'docker' | 'nomad' | 'opensandbox'

/** Reported liveness of an environment, driven by runner heartbeats. */
export type EnvironmentStatus = 'pending' | 'online' | 'degraded' | 'offline'

// Compute sizing reuses the existing ComputeResources (quantity strings with
// request/limit split) from ./api — it carries exactly what the k8s provider
// needs and is portable enough (e.g. "1Gi"/"500m") for other backends to map.
// A richer numeric form can replace it later if a backend needs one.

/** What the control plane *wants* a workspace to be. */
export type DesiredPhase = 'running' | 'stopped' | 'deleted'

/** What the runner *observes* a workspace to be. */
export type ObservedPhase = 'pending' | 'starting' | 'running' | 'stopped' | 'error' | 'unknown'

export interface PortSpec {
  name: string
  port: number
}

/**
 * Optional stateful features, modelled as enable-flags: they gate whether the
 * afs-fuse / memory-fuse sidecar is included, while the actual mounts are
 * resolved at runtime (afs via bootstrap pull, memory via cp) rather than
 * carried statically in the spec. A feature that needs its own parameters can
 * grow a richer shape here.
 */
export interface WorkspaceFeatures {
  /** Include the shared-AgentFS sidecar (afs-fuse). */
  sharedFs?: boolean
  /** Include the persistent-memory sidecar (memory-fuse). */
  persistentMemory?: boolean
}

/**
 * The infra-agnostic description of a workspace's desired runtime. A provider
 * turns this into concrete infra objects (e.g. Deployment/Service/PVC for k8s).
 * `version` mirrors `workspace_placements.spec_version` and is the drift anchor:
 * the runner re-applies only when the spec version advances past what it has
 * observed.
 */
export interface WorkspaceSpec {
  /**
   * Which agent runs in the workspace. The k8s provider derives the container
   * image from this (image = `<prefix>-<agentType>:<tag>`); this is the real
   * per-workspace provisioning input today.
   */
  agentType: string
  resources: ComputeResources
  /** Drift anchor; mirrors workspace_placements.spec_version. */
  version: number

  /**
   * Runtime shape of the workspace, and the sole discriminator providers branch
   * on. See {@link RuntimeMode}. Always present: a spec that reaches a provider
   * has been normalised, so no consumer defaults it.
   */
  runtimeMode: RuntimeMode
  /**
   * Desired replica count under `'auto-scaling'` (the autoscaler writes it).
   * Ignored for `'static'`, which is always 1.
   */
  replicas?: number

  // ── Reserved: accepted by the contract, unused by the k8s provider ──
  /** Explicit container image, if a backend takes one directly instead of agentType. */
  image?: string
  env?: Record<string, string>
  ports?: PortSpec[]
  features?: WorkspaceFeatures
}

/**
 * Capabilities a provider/environment advertises, used by the control plane to
 * validate placement ("workspace's required features ⊆ environment
 * capabilities") and to drive UI. Extensible via index signature.
 */
export interface Capabilities {
  sharedFs: boolean
  persistentMemory: boolean
  /**
   * The environment can run more than one replica of a single workspace, all
   * sharing one persistent ReadWriteMany workspace volume — the requirement for
   * `WorkspaceSpec.runtimeMode === 'auto-scaling'`. Distinct from `sharedFs`,
   * which is the cross-workspace AgentFS sidecar, not the workspace's own
   * volume. A k8s provider advertises this only when its storage class supports
   * ReadWriteMany.
   */
  multiReplica?: boolean
  [key: string]: boolean | number | string | undefined
}

/**
 * How a running workspace is reached. For the built-in environment this is
 * cluster DNS; for a remote environment it is a tunnel routing key the runner
 * reports. Deliberately loose — what constitutes an address is the backend's
 * business, and cp only passes it to the routing seam.
 */
export interface EnvironmentEndpoint {
  /** Direct address for built-in (e.g. host:port resolvable from cp). */
  address?: string
  /** Tunnel routing key for remote environments. */
  routeKey?: string
  /**
   * The provider-assigned ids of the Ready replicas — the readiness signal cp
   * routes on, sizes turn capacity from, and fans reloads out over. Reported by
   * every runtime shape, so reachability is one uniform signal: a running static
   * workspace reports its single replica, an auto-scaling one reports however
   * many are ready, and anything not up reports none.
   *
   * It rides on the endpoint rather than being a separate observed field because
   * the ready set IS a workspace's reachability.
   */
  readyReplicaIds?: number[]
}

/** The runner's observation of a single workspace, written back to cp. */
export interface ObservedState {
  phase: ObservedPhase
  /** The spec version the runner has converged to. */
  version?: number
  /**
   * Version of the pod template the workload is actually built from — distinct
   * from {@link version}, which tracks placement-spec convergence. cp caches it
   * on the workspace row so "rebuild available" is a DB comparison rather than a
   * live infra read. Omitted when the backend stamps no such version, or when
   * nothing is provisioned to read one from.
   */
  templateVersion?: number
  /** Reachability, including the ready replica set cp routes on. */
  endpoint?: EnvironmentEndpoint
  message?: string
}

/** A handle returned by {@link EnvironmentProvider.watch} to stop watching. */
export interface Closable {
  close(): void
}

/**
 * The single abstraction all provisioning backends implement. KubernetesProvider
 * is the first, and the built-in environment uses it in-process. All lifecycle
 * methods are idempotent and take infra-agnostic arguments.
 */
export interface EnvironmentProvider {
  /** Create if absent; converge if drifted. */
  apply(workspaceId: string, spec: WorkspaceSpec): Promise<void>
  /**
   * Bring the workspace up. The mode is passed in rather than discovered,
   * because acting on a workspace means acting on one specific shape's infra and
   * the caller is the one holding its desired state.
   */
  start(workspaceId: string, mode: RuntimeMode): Promise<void>

  /**
   * Optional: put a freshly minted workspace token where the workload will find
   * it, before the workload starts.
   *
   * Deliberately not part of {@link WorkspaceSpec} — the spec is desired state
   * that cp stores and diffs, and a credential must not live there. The runner
   * mints one per materialisation and hands it over here; how it reaches the
   * process is the backend's business (a Kubernetes Secret, a bind-mounted file,
   * a systemd credential), and the workload's side of the contract is only that
   * it arrives in the environment as WORKSPACE_TOKEN.
   *
   * A backend with no way to deliver a secret omits this; its workloads then run
   * without a token and can only reach the endpoints that do not require one.
   */
  deliverWorkspaceToken?(workspaceId: string, token: string): Promise<void>
  stop(workspaceId: string, mode: RuntimeMode): Promise<void>
  /**
   * Remove the workspace's infra. Takes no mode: teardown must not depend on
   * getting the shape right, since a wrong guess leaks infra nothing will come
   * back for.
   */
  destroy(workspaceId: string): Promise<void>

  /**
   * Point-in-time observation. `mode` lets a caller that knows the shape skip
   * discovering it; without one the backend answers by looking.
   */
  observe(workspaceId: string, mode?: RuntimeMode): Promise<ObservedState>
  /**
   * Optional batch observation: one round-trip for every workspace the provider
   * currently has (e.g. a single k8s LIST). The map is keyed by workspace id;
   * ids absent from it are unprovisioned (phase 'unknown'). When present, the
   * reconcile loop uses this once per pass instead of N× {@link observe} —
   * O(1) round-trips instead of O(N). Absent → callers fall back to observe().
   */
  observeAll?(): Promise<Map<string, ObservedState>>
  /** Optional change stream; absent → callers fall back to polling observe(). */
  watch?(onChange: (workspaceId: string, state: ObservedState) => void): Closable

  capabilities(): Capabilities
}

/**
 * The cp↔runner placement record: desired state (cp writes) + observed state
 * (runner writes), mirroring the `workspace_placements` row. Used by the pull
 * protocol; in v1 the in-process runner reads/writes it directly.
 */
export interface PlacementRecord {
  workspaceId: string
  environmentId: string

  // desired (cp writes)
  desiredPhase: DesiredPhase
  spec: WorkspaceSpec
  specVersion: number

  // observed (runner writes)
  observedPhase?: ObservedPhase
  observedVersion?: number
  endpoint?: EnvironmentEndpoint
  message?: string
}
