/**
 * Parsers for the k8s quantity strings stored in `compute_resources`
 * (`"250m"`, `"2Gi"`, `"50Gi"`). Shared by the cluster view and the resource
 * summary so both read a workspace's footprint the same way.
 */

/** CPU quantity → millicores. `"250m"` → 250, `"2"` → 2000. */
export function parseCpuMillis(val?: string): number {
  if (!val) return 0
  if (val.endsWith('m')) return Number.parseInt(val)
  return Number.parseFloat(val) * 1000
}

/** Memory quantity → MiB. Unsuffixed and unrecognised values yield 0. */
export function parseMemMi(val?: string): number {
  if (!val) return 0
  if (val.endsWith('Gi')) return Number.parseFloat(val) * 1024
  if (val.endsWith('Mi')) return Number.parseFloat(val)
  if (val.endsWith('Ki')) return Number.parseFloat(val) / 1024
  if (val.endsWith('G')) return Number.parseFloat(val) * 953.674
  if (val.endsWith('M')) return Number.parseFloat(val) * 0.953674
  return 0
}
