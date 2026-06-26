import type { EnvironmentProvider } from '../../internal/types/environments'
import { listKubernetesPlacements, writeObserved } from './db'

// Provider-agnostic reconcile core. It depends only on EnvironmentProvider, so
// when a second runner (env-runner-docker, …) appears this file moves verbatim
// into internal/env-runner-core and each runner wires its own provider.

/**
 * One read-only reconcile pass (P0): observe every placement and write the
 * observed state back. It does NOT apply or change any workspace — this proves
 * the observe link + DB writes work without touching pods (zero apply / zero
 * lifecycle). The desired→actual convergence is wired in P1.
 */
async function observeOnce(
  provider: EnvironmentProvider,
): Promise<{ observed: number; failed: number }> {
  const placements = await listKubernetesPlacements()
  let observed = 0
  let failed = 0
  for (const p of placements) {
    try {
      const state = await provider.observe(p.workspace_id)
      await writeObserved(p.workspace_id, {
        phase: state.phase,
        endpoint: state.endpoint,
        message: state.message,
      })
      observed++
    } catch (err) {
      failed++
      console.error(`[env-runner-k8s] observe failed for ${p.workspace_id}:`, err)
    }
  }
  return { observed, failed }
}

/** Run {@link observeOnce} on an interval until the returned stop() is called. */
export function startObserveLoop(provider: EnvironmentProvider, intervalMs: number): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const tick = async () => {
    if (stopped) return
    try {
      const { observed, failed } = await observeOnce(provider)
      console.log(
        `[env-runner-k8s] observe pass: ${observed} ok, ${failed} failed, 0 apply / 0 lifecycle`,
      )
    } catch (err) {
      console.error('[env-runner-k8s] observe pass failed:', err)
    }
    if (!stopped) timer = setTimeout(tick, intervalMs)
  }

  void tick()
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
  }
}
