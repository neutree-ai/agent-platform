/**
 * Shared environment-provisioning contract types (BYOI).
 *
 * An *environment* is a place where workspaces are provisioned. The control
 * plane publishes desired state per workspace and a *runner* — in-process for
 * the built-in environment, remote for BYOI — reconciles it against an
 * {@link EnvironmentProvider} implementation (KubernetesProvider being the
 * first). These types are the infra-agnostic seam between the two halves.
 *
 * See tmp/byoi-environments-design.md §3–§5. v1 (P0/P1) only exercises the
 * built-in environment via an in-process runner; remote-only fields are marked.
 */

import type { ComputeResources } from './api.js'

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
export type ObservedPhase =
  | 'pending'
  | 'starting'
  | 'running'
  | 'stopped'
  | 'error'
  | 'unknown'

export interface PortSpec {
  name: string
  port: number
}

/**
 * Optional stateful features. v1 models these as enable-flags: the sidecar
 * (afs-fuse / memory-fuse) inclusion is gated by them, but the actual mounts
 * are resolved at runtime (afs via bootstrap pull, memory via CP), not carried
 * statically in the spec. Richer per-feature specs may be added when data
 * services sink into BYOI environments (design §6, P3).
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

  // ── Reserved / forward-looking (unused by the v1 k8s provider) ──
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
  gpu: boolean
  maxStorageGi?: number
  [key: string]: boolean | number | string | undefined
}

/**
 * How a running workspace is reached. For the built-in environment this is
 * cluster DNS; for a remote environment it is a tunnel routing key reported by
 * the runner (design §6). Shape is intentionally loose during v1.
 */
export interface EnvironmentEndpoint {
  /** Direct address for built-in (e.g. host:port resolvable from cp). */
  address?: string
  /** Tunnel routing key for remote environments (P2). */
  routeKey?: string
}

/** The runner's observation of a single workspace, written back to cp. */
export interface ObservedState {
  phase: ObservedPhase
  /** The spec version the runner has converged to. */
  version?: number
  endpoint?: EnvironmentEndpoint
  message?: string
}

/** A handle returned by {@link EnvironmentProvider.watch} to stop watching. */
export interface Closable {
  close(): void
}

/**
 * The single abstraction all provisioning backends implement. KubernetesProvider
 * (extracted from control-plane/src/services/k8s.ts) is the first; the built-in
 * environment uses it in-process. All lifecycle methods are idempotent and take
 * infra-agnostic arguments.
 */
export interface EnvironmentProvider {
  /** Create if absent; converge if drifted. */
  apply(workspaceId: string, spec: WorkspaceSpec): Promise<void>
  start(workspaceId: string): Promise<void>
  stop(workspaceId: string): Promise<void>
  destroy(workspaceId: string): Promise<void>
  resize(workspaceId: string, resources: ComputeResources): Promise<void>
  expandStorage(workspaceId: string, sizeGi: number): Promise<void>

  /** Point-in-time observation. */
  observe(workspaceId: string): Promise<ObservedState>
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
