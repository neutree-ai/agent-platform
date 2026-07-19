import type * as k8s from '@kubernetes/client-node'
import type { K8sConfig } from './config'

// Shared helpers used by both workload shapes (the static Deployment path on
// KubernetesProvider and the AutoScalingWorkload StatefulSet path). Pure /
// stateless over injected api clients + config, so neither shape depends on the
// other.

/** A delete/read whose 404 means "already gone" = success; rethrow the rest. */
export function swallow404(e: any): void {
  if (e.response?.statusCode !== 404) throw e
}

/**
 * Run a create call, adopting an already-existing object instead of failing.
 * Provisioning must be idempotent: the reconcile loop re-enters it every tick
 * while a workspace is unconverged, and the PVC/Service deliberately outlive the
 * workload (rebuild, manual deletion). A bare create would 409 on the survivors
 * forever and deadlock the reconcile.
 */
export async function createOrAdopt(create: () => Promise<unknown>): Promise<void> {
  try {
    await create()
  } catch (e: any) {
    if (e.response?.statusCode !== 409) throw e
  }
}

/** The k8s object name for a workspace's resources (`<prefix>-<wsId>`). */
export function resourceName(cfg: K8sConfig, workspaceId: string): string {
  return `${cfg.namePrefix}-${workspaceId}`
}

/** Common labels / selector for a workspace's resources. */
export function workspaceLabels(cfg: K8sConfig, workspaceId: string): Record<string, string> {
  return {
    app: cfg.namePrefix,
    component: 'workspace',
    'workspace-id': workspaceId,
  }
}

/** The workspace's persistent-volume-claim name. */
export function workspacePvcName(cfg: K8sConfig, workspaceId: string): string {
  return `${resourceName(cfg, workspaceId)}-workspace`
}

/** A pod is Ready when it has container statuses and all of them are ready. */
export function isPodReady(pod: k8s.V1Pod): boolean {
  const statuses = pod.status?.containerStatuses ?? []
  return statuses.length > 0 && statuses.every((c) => c.ready)
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

/**
 * Expand a workspace PVC. K8s only ever allows a PVC to grow, never shrink —
 * patching a smaller size is rejected by the API. A desired spec asking for
 * less than what's provisioned (e.g. a stale/lowered compute_resources value)
 * is treated as a no-op here rather than an error, so it can't block spec
 * convergence for every other field forever (see incident: apply() threw on
 * this every reconcile pass, tearing down and recreating the workload before
 * the new pod could ever pass its startup probe). 404-tolerant: false when the
 * PVC doesn't exist.
 */
export async function expandWorkspacePvc(
  coreApi: k8s.CoreV1Api,
  cfg: K8sConfig,
  pvcName: string,
  newSize: string,
): Promise<boolean> {
  try {
    const current = await coreApi.readNamespacedPersistentVolumeClaim(pvcName, cfg.namespace)
    const currentSize = current.body.spec?.resources?.requests?.storage
    if (currentSize && parseStorageQuantity(newSize) <= parseStorageQuantity(currentSize)) {
      return true
    }
  } catch (e: any) {
    if (e.response?.statusCode === 404) return false
    throw e
  }

  try {
    await coreApi.patchNamespacedPersistentVolumeClaim(
      pvcName,
      cfg.namespace,
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
