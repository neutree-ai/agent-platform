import type { ObservedState, WorkspaceSpec } from '../types/environments'

/**
 * One runtime shape's infra, behind a shape-independent surface.
 *
 * The two implementations — {@link StaticWorkload} (Deployment + ClusterIP
 * Service) and {@link AutoScalingWorkload} (StatefulSet + headless Service +
 * shared RWX volume) — build genuinely different Kubernetes objects. Everything
 * above them, in {@link KubernetesProvider}, is the same for both, so the only
 * place the shapes are told apart is the single switch that picks one.
 *
 * Both share the pod template ({@link buildWorkspacePodTemplate}) and the Service
 * selector, so what runs *inside* a workspace cannot drift between them.
 *
 * Every method is idempotent: the reconcile loop re-enters them on each pass
 * while a workspace is unconverged.
 */
export interface WorkspaceWorkload {
  /** Create if absent, converge if drifted. */
  apply(workspaceId: string, spec: WorkspaceSpec): Promise<void>
  /** Bring the workspace up. No-op when it has no infra to wake. */
  start(workspaceId: string): Promise<void>
  /** Scale the workspace to nothing, keeping its persistent state. */
  stop(workspaceId: string): Promise<void>
  /** Remove the workspace's infra, including its volume. 404-tolerant. */
  destroy(workspaceId: string): Promise<void>
  /** Point-in-time observation; phase 'unknown' when nothing is provisioned. */
  observe(workspaceId: string): Promise<ObservedState>
  /** Batch counterpart: every workspace this shape currently has. */
  observeAll(): Promise<Map<string, ObservedState>>
}
